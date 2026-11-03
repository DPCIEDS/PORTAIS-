#!/usr/bin/env python3
"""
MCP Server - Google Sheets & Google Drive
===========================================

Servidor MCP (Model Context Protocol) em arquivo único que expõe ferramentas
para interagir com uma Planilha Google específica e uma pasta/arquivo do
Google Drive específico.

IDs configurados:
    SPREADSHEET_ID = "1gX_uwAY4Go4oaqDsPV4qZlN3l2ZFwWqtNuERzQy3WzQ"
    DRIVE_ID       = "1pHTPAoewl5Lme_mFZinYpgUKUTbz9YDg"

------------------------------------------------------------------------------
PRÉ-REQUISITOS
------------------------------------------------------------------------------
1. Instalar dependências:

    pip install mcp google-api-python-client google-auth google-auth-httplib2

2. Criar uma Service Account no Google Cloud Console:
   - Acesse https://console.cloud.google.com/
   - Crie/selecione um projeto
   - Habilite as APIs: "Google Sheets API" e "Google Drive API"
   - Crie uma Service Account (IAM & Admin > Service Accounts)
   - Gere uma chave JSON e salve, por exemplo, em: ./credentials.json
   - IMPORTANTE: compartilhe a Planilha e a pasta/arquivo do Drive com o
     e-mail da service account (algo como
     nome@projeto.iam.gserviceaccount.com), dando permissão de Editor.

3. Definir a variável de ambiente apontando para o JSON de credenciais:

    export GOOGLE_APPLICATION_CREDENTIALS="/caminho/para/credentials.json"

   (No Windows: set GOOGLE_APPLICATION_CREDENTIALS=C:/caminho/credentials.json)

------------------------------------------------------------------------------
COMO REGISTRAR NO CLAUDE DESKTOP / CLAUDE CODE
------------------------------------------------------------------------------
Adicione ao seu claude_desktop_config.json (ou config equivalente):

{
  "mcpServers": {
    "google-sheets-drive": {
      "command": "python3",
      "args": ["/caminho/completo/para/mcp_google_sheets_drive.py"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/caminho/para/credentials.json"
      }
    }
  }
}

------------------------------------------------------------------------------
FERRAMENTAS DISPONÍVEIS
------------------------------------------------------------------------------
Planilha (Google Sheets):
  - sheets_get_metadata()                -> Metadados da planilha e suas abas
  - sheets_read_range(range, sheet_name) -> Lê valores de um intervalo (ex: "A1:D10")
  - sheets_write_range(range, values)    -> Sobrescreve valores em um intervalo
  - sheets_append_rows(values, sheet_name) -> Adiciona linhas ao final da aba
  - sheets_clear_range(range)            -> Limpa valores de um intervalo

Drive (Google Drive):
  - drive_get_info()                     -> Informações do arquivo/pasta configurado
  - drive_list_files(query, page_size)   -> Lista arquivos (opcionalmente dentro da pasta configurada)
  - drive_get_file_metadata(file_id)     -> Metadados de um arquivo específico
  - drive_download_file_text(file_id)    -> Baixa conteúdo de texto de um arquivo (Google Docs/Sheets exportados, txt, csv, etc.)
  - drive_create_folder(name, parent_id) -> Cria uma nova pasta (por padrão dentro da pasta configurada)
  - drive_delete_file(file_id)           -> Move um arquivo para a lixeira
"""

import os
import sys
import io
import logging
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError

# ------------------------------------------------------------------------------
# CONFIGURAÇÃO FIXA (IDs fornecidos)
# ------------------------------------------------------------------------------
SPREADSHEET_ID = "1gX_uwAY4Go4oaqDsPV4qZlN3l2ZFwWqtNuERzQy3WzQ"
DRIVE_ID = "1pHTPAoewl5Lme_mFZinYpgUKUTbz9YDg"  # pode ser um ID de pasta ou de arquivo

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

CREDENTIALS_ENV_VAR = "GOOGLE_APPLICATION_CREDENTIALS"
DEFAULT_CREDENTIALS_PATH = "credentials.json"

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger("mcp-google-sheets-drive")

# ------------------------------------------------------------------------------
# AUTENTICAÇÃO
# ------------------------------------------------------------------------------
def _load_credentials() -> service_account.Credentials:
    creds_path = os.environ.get(CREDENTIALS_ENV_VAR, DEFAULT_CREDENTIALS_PATH)
    if not os.path.exists(creds_path):
        raise FileNotFoundError(
            f"Arquivo de credenciais não encontrado em '{creds_path}'. "
            f"Defina a variável de ambiente {CREDENTIALS_ENV_VAR} apontando "
            f"para o JSON da sua Service Account, ou coloque o arquivo em "
            f"'{DEFAULT_CREDENTIALS_PATH}'."
        )
    return service_account.Credentials.from_service_account_file(
        creds_path, scopes=SCOPES
    )


_credentials: Optional[service_account.Credentials] = None
_sheets_service = None
_drive_service = None


def get_sheets_service():
    global _credentials, _sheets_service
    if _sheets_service is None:
        if _credentials is None:
            _credentials = _load_credentials()
        _sheets_service = build("sheets", "v4", credentials=_credentials)
    return _sheets_service


def get_drive_service():
    global _credentials, _drive_service
    if _drive_service is None:
        if _credentials is None:
            _credentials = _load_credentials()
        _drive_service = build("drive", "v3", credentials=_credentials)
    return _drive_service


# ------------------------------------------------------------------------------
# SERVIDOR MCP
# ------------------------------------------------------------------------------
mcp = FastMCP("google-sheets-drive")


# ==============================================================================
# FERRAMENTAS - GOOGLE SHEETS
# ==============================================================================

@mcp.tool()
def sheets_get_metadata() -> dict[str, Any]:
    """Retorna metadados da planilha configurada (título, abas/sheets, dimensões)."""
    try:
        service = get_sheets_service()
        result = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        sheets_info = []
        for sh in result.get("sheets", []):
            props = sh.get("properties", {})
            grid = props.get("gridProperties", {})
            sheets_info.append({
                "title": props.get("title"),
                "sheetId": props.get("sheetId"),
                "rowCount": grid.get("rowCount"),
                "columnCount": grid.get("columnCount"),
            })
        return {
            "spreadsheetId": SPREADSHEET_ID,
            "title": result.get("properties", {}).get("title"),
            "sheets": sheets_info,
            "url": result.get("spreadsheetUrl"),
        }
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def sheets_read_range(range: str, sheet_name: Optional[str] = None) -> dict[str, Any]:
    """
    Lê valores de um intervalo da planilha.

    Args:
        range: Intervalo em notação A1, ex: "A1:D10" ou apenas "A:A".
        sheet_name: Nome da aba (opcional). Se informado, é combinado com range,
                    ex: sheet_name="Vendas", range="A1:D10" -> "Vendas!A1:D10".
    """
    try:
        service = get_sheets_service()
        full_range = f"{sheet_name}!{range}" if sheet_name else range
        result = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=full_range
        ).execute()
        return {
            "range": result.get("range"),
            "values": result.get("values", []),
        }
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def sheets_write_range(range: str, values: list[list[Any]], sheet_name: Optional[str] = None) -> dict[str, Any]:
    """
    Sobrescreve valores em um intervalo da planilha (RAW - sem interpretar fórmulas).

    Args:
        range: Intervalo em notação A1, ex: "A1:C3".
        values: Lista de listas com os valores, ex: [["a", "b"], ["c", "d"]].
        sheet_name: Nome da aba (opcional).
    """
    try:
        service = get_sheets_service()
        full_range = f"{sheet_name}!{range}" if sheet_name else range
        body = {"values": values}
        result = service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=full_range,
            valueInputOption="USER_ENTERED",
            body=body,
        ).execute()
        return {
            "updatedRange": result.get("updatedRange"),
            "updatedRows": result.get("updatedRows"),
            "updatedColumns": result.get("updatedColumns"),
            "updatedCells": result.get("updatedCells"),
        }
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def sheets_append_rows(values: list[list[Any]], sheet_name: Optional[str] = None) -> dict[str, Any]:
    """
    Adiciona novas linhas ao final da tabela existente na planilha (ou aba especificada).

    Args:
        values: Lista de listas com os valores das novas linhas.
        sheet_name: Nome da aba (opcional). Se omitido, usa a primeira aba.
    """
    try:
        service = get_sheets_service()
        target_range = sheet_name if sheet_name else "A1"
        body = {"values": values}
        result = service.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range=target_range,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body=body,
        ).execute()
        updates = result.get("updates", {})
        return {
            "updatedRange": updates.get("updatedRange"),
            "updatedRows": updates.get("updatedRows"),
            "updatedCells": updates.get("updatedCells"),
        }
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def sheets_clear_range(range: str, sheet_name: Optional[str] = None) -> dict[str, Any]:
    """
    Limpa (apaga) os valores de um intervalo da planilha, mantendo a formatação.

    Args:
        range: Intervalo em notação A1, ex: "A1:D10".
        sheet_name: Nome da aba (opcional).
    """
    try:
        service = get_sheets_service()
        full_range = f"{sheet_name}!{range}" if sheet_name else range
        result = service.spreadsheets().values().clear(
            spreadsheetId=SPREADSHEET_ID, range=full_range, body={}
        ).execute()
        return {"clearedRange": result.get("clearedRange")}
    except HttpError as e:
        return {"error": str(e)}


# ==============================================================================
# FERRAMENTAS - GOOGLE DRIVE
# ==============================================================================

@mcp.tool()
def drive_get_info() -> dict[str, Any]:
    """Retorna metadados do arquivo ou pasta do Drive configurado (DRIVE_ID)."""
    try:
        service = get_drive_service()
        fields = "id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents, owners"
        result = service.files().get(fileId=DRIVE_ID, fields=fields).execute()
        return result
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def drive_list_files(query: Optional[str] = None, page_size: int = 20) -> dict[str, Any]:
    """
    Lista arquivos do Drive. Por padrão, lista os arquivos dentro da pasta
    configurada (DRIVE_ID), caso ela seja de fato uma pasta.

    Args:
        query: Filtro adicional na sintaxe de query do Google Drive
               (ex: "name contains 'relatorio'"). Opcional.
        page_size: Número máximo de resultados (padrão 20, máximo 100).
    """
    try:
        service = get_drive_service()
        base_query = f"'{DRIVE_ID}' in parents and trashed = false"
        full_query = f"{base_query} and ({query})" if query else base_query
        result = service.files().list(
            q=full_query,
            pageSize=min(page_size, 100),
            fields="files(id, name, mimeType, modifiedTime, size, webViewLink)",
        ).execute()
        return {"files": result.get("files", [])}
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def drive_get_file_metadata(file_id: str) -> dict[str, Any]:
    """
    Retorna metadados de um arquivo específico do Drive pelo seu ID.

    Args:
        file_id: ID do arquivo no Google Drive.
    """
    try:
        service = get_drive_service()
        fields = "id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents"
        result = service.files().get(fileId=file_id, fields=fields).execute()
        return result
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def drive_download_file_text(file_id: str) -> dict[str, Any]:
    """
    Baixa o conteúdo textual de um arquivo do Drive.
    - Google Docs são exportados como texto simples (.txt).
    - Google Sheets são exportados como CSV.
    - Arquivos binários comuns (txt, csv, json, etc.) são baixados diretamente.

    Args:
        file_id: ID do arquivo no Google Drive.
    """
    try:
        service = get_drive_service()
        meta = service.files().get(fileId=file_id, fields="mimeType, name").execute()
        mime_type = meta.get("mimeType", "")
        name = meta.get("name", "")

        export_map = {
            "application/vnd.google-apps.document": "text/plain",
            "application/vnd.google-apps.spreadsheet": "text/csv",
            "application/vnd.google-apps.presentation": "text/plain",
        }

        buffer = io.BytesIO()
        if mime_type in export_map:
            request = service.files().export_media(
                fileId=file_id, mimeType=export_map[mime_type]
            )
        else:
            request = service.files().get_media(fileId=file_id)

        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        try:
            content = buffer.getvalue().decode("utf-8")
        except UnicodeDecodeError:
            content = "<conteúdo binário não pôde ser decodificado como texto>"

        return {"name": name, "mimeType": mime_type, "content": content}
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def drive_create_folder(name: str, parent_id: Optional[str] = None) -> dict[str, Any]:
    """
    Cria uma nova pasta no Google Drive.

    Args:
        name: Nome da nova pasta.
        parent_id: ID da pasta pai (opcional). Se omitido, cria dentro da
                   pasta configurada (DRIVE_ID).
    """
    try:
        service = get_drive_service()
        target_parent = parent_id if parent_id else DRIVE_ID
        file_metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [target_parent],
        }
        result = service.files().create(
            body=file_metadata, fields="id, name, webViewLink"
        ).execute()
        return result
    except HttpError as e:
        return {"error": str(e)}


@mcp.tool()
def drive_delete_file(file_id: str) -> dict[str, Any]:
    """
    Move um arquivo do Drive para a lixeira (não exclui permanentemente).

    Args:
        file_id: ID do arquivo a ser movido para a lixeira.
    """
    try:
        service = get_drive_service()
        service.files().update(fileId=file_id, body={"trashed": True}).execute()
        return {"status": "ok", "message": f"Arquivo {file_id} movido para a lixeira."}
    except HttpError as e:
        return {"error": str(e)}


# ------------------------------------------------------------------------------
# ENTRYPOINT
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    mcp.run(transport="stdio")
