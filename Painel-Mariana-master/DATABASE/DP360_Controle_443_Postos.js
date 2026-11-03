/** DP360 | 443 postos da primeira leva — módulo independente.
 * Cole como NOVO arquivo .gs no Apps Script vinculado à DATABASE.
 * Execute dp443Preparar(), preencha e confira QUADRO_443_OFICIAL e MAPA_443,
 * depois execute dp443Atualizar(). Para filtro automático, execute dp443InstalarFiltro().
 * NÃO executa nem modifica o módulo gerencial anterior ou CHECKLIST_ADMISSAO.
 * IMPORTANTE: QUADRO_443_OFICIAL deve conter APENAS os postos desta leva;
 * a soma de QUANTIDADE_PREVISTA nas linhas conferidas deve ser exatamente 443.
 */
const DP443 = Object.freeze({
  ATIVOS:'ALTERDATA', CANCEL:'Cancelados', QUADRO:'QUADRO_443_OFICIAL', MAPA:'MAPA_443',
  POSTOS:'CONTROLE_POSTOS', PESSOAS:'CONFERENCIA_POSTOS', DADOS:'_DP443_DADOS', PEND:'PENDENCIAS_443',
  TOTAL:443,
  HQUADRO:['ITEM','DEPARTAMENTO_OFICIAL','CARGO_OFICIAL','QUANTIDADE_PREVISTA','SALARIO_BASE_EDITAL','INSALUBRIDADE_OFICIAL','FONTE_QUANTIDADE','FONTE_SALARIO','FONTE_INSALUBRIDADE','CONFERIDO'],
  HMAPA:['DEPARTAMENTO_ALTERDATA','ITEM','DEPARTAMENTO_OFICIAL','CONFERIDO'],
  HPOST:['ITEM','DEPARTAMENTO','POSTO','PREVISTO','ATIVO','DIFERENCA','INDICADOR','SALARIO_EDITAL','SALARIO_CONFORMIDADE','INSALUBRIDADE_OFICIAL','OBSERVACOES'],
  HPESS:['NOME','DEPARTAMENTO','ITEM','POSTO','SALARIO_ALTERDATA','SALARIO_EDITAL','FAROL_SALARIO','INSALUBRIDADE_OFICIAL','STATUS','OBSERVACOES'],
  HPEND:['TIPO','ITEM','DEPARTAMENTO','POSTO','FUNCIONARIO','DESCRICAO']
});
function dp443N(x){return String(x==null?'':x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toUpperCase();}
function dp443Money(x){if(typeof x==='number')return Number.isFinite(x)?x:null;const s=String(x==null?'':x).replace(/R\$|\s/g,'');if(!s)return null;const a=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;const n=Number(a);return Number.isFinite(n)?n:null;}
function dp443Ok(x){return x===true||['SIM','TRUE','VERDADEIRO','1','CONFERIDO'].includes(dp443N(x));}
function dp443K(a,b,c){return [dp443N(a),dp443N(b),dp443N(c)].join('§');}
function dp443Sheet(ss,name,headers){let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getMaxColumns()<headers.length)sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#16365e').setFontColor('#ffffff');sh.setFrozenRows(1);return sh;}
function dp443Rows(sh){if(!sh||sh.getLastRow()<2)return [];const v=sh.getDataRange().getValues(),heads=v[0].map(dp443N);return v.slice(1).map((r,i)=>({r,row:i+2,get:(...names)=>{for(const n of names){const j=heads.indexOf(dp443N(n));if(j>=0&&r[j]!==''&&r[j]!=null)return r[j];}return '';}})).filter(x=>x.r.some(v=>v!==''&&v!==null));}
function dp443Write(sh,headers,rows,start=2){const old=sh.getLastRow();if(old>=start)sh.getRange(start,1,old-start+1,headers.length).clearContent();if(rows.length){if(sh.getMaxRows()<start+rows.length-1)sh.insertRowsAfter(sh.getMaxRows(),start+rows.length-1-sh.getMaxRows());sh.getRange(start,1,rows.length,headers.length).setValues(rows);}}
function dp443RequireSheet(ss,name){const sh=ss.getSheetByName(name);if(!sh)throw Error('Aba fonte ausente: '+name+'. Não foi criada nem alterada automaticamente.');return sh;}
function dp443PrepareDropdown(sh){const cell=sh.getRange('B2');sh.getRange('A2').setValue('DEPARTAMENTO:');cell.setValue('Todos');sh.getRange('A4:J4').setValues([DP443.HPESS]).setFontWeight('bold').setBackground('#16365e').setFontColor('#ffffff');sh.setFrozenRows(4);}
function dp443Preparar(){const ss=SpreadsheetApp.getActiveSpreadsheet();dp443RequireSheet(ss,DP443.ATIVOS);dp443RequireSheet(ss,DP443.CANCEL);
 const q=dp443Sheet(ss,DP443.QUADRO,DP443.HQUADRO),m=dp443Sheet(ss,DP443.MAPA,DP443.HMAPA);
 dp443Sheet(ss,DP443.POSTOS,DP443.HPOST);dp443Sheet(ss,DP443.DADOS,DP443.HPESS);dp443Sheet(ss,DP443.PEND,DP443.HPEND);
 const p=ss.getSheetByName(DP443.PESSOAS)||ss.insertSheet(DP443.PESSOAS);dp443PrepareDropdown(p);
 q.getRange(2,10,q.getMaxRows()-1,1).insertCheckboxes();m.getRange(2,4,m.getMaxRows()-1,1).insertCheckboxes();
 ss.getSheetByName(DP443.DADOS).hideSheet();
 SpreadsheetApp.getActive().toast('Abas criadas. Preencha somente os postos oficiais dos 443 e confira as fontes.', 'DP360',8);
}
function dp443Atualizar(){
 const lock=LockService.getDocumentLock();if(lock&&!lock.tryLock(15000))throw Error('Outra atualização em andamento.');
 try{
 const ss=SpreadsheetApp.getActiveSpreadsheet();const ativos=dp443RequireSheet(ss,DP443.ATIVOS),cancel=dp443RequireSheet(ss,DP443.CANCEL);
 const qsh=dp443RequireSheet(ss,DP443.QUADRO),msh=dp443RequireSheet(ss,DP443.MAPA);
 const post=dp443Sheet(ss,DP443.POSTOS,DP443.HPOST),data=dp443Sheet(ss,DP443.DADOS,DP443.HPESS),pend=dp443Sheet(ss,DP443.PEND,DP443.HPEND);
 const people=ss.getSheetByName(DP443.PESSOAS)||ss.insertSheet(DP443.PESSOAS);dp443PrepareDropdownIfMissing(people);
 const issues=[],issue=(t,it,d,c,n,msg)=>issues.push([t,it,d,c,n,msg]);
 const Q=new Map(),invalidKeys=new Set();let total=0;
 for(const x of dp443Rows(qsh)){
  const it=x.get('ITEM'),d=x.get('DEPARTAMENTO_OFICIAL'),c=x.get('CARGO_OFICIAL'),key=dp443K(it,d,c);
  if(!it||!d||!c){issue('OFICIAL_INCOMPLETO',it,d,c,'','Identificação do posto incompleta, linha '+x.row);continue;}
  if(!dp443Ok(x.get('CONFERIDO'))){issue('OFICIAL_NAO_CONFERIDO',it,d,c,'','Linha '+x.row+' não conferida');continue;}
  const qtd=dp443Money(x.get('QUANTIDADE_PREVISTA')),sal=dp443Money(x.get('SALARIO_BASE_EDITAL')),
   ins=dp443Money(x.get('INSALUBRIDADE_OFICIAL'));
  const srcQ=x.get('FONTE_QUANTIDADE'),srcS=x.get('FONTE_SALARIO'),srcI=x.get('FONTE_INSALUBRIDADE');
  if(Q.has(key)||invalidKeys.has(key)){issue('POSTO_DUPLICADO',it,d,c,'','Posto repetido na matriz oficial; resolver antes de validar');invalidKeys.add(key);Q.delete(key);continue;}
  if(!Number.isInteger(qtd)||qtd<0||!srcQ){issue('QUANTIDADE_PENDENTE',it,d,c,'','Quantidade ou referência documental ausente/inválida');continue;}
  if(sal===null||sal<0||!srcS)issue('SALARIO_EDITAL_PENDENTE',it,d,c,'','Salário oficial ou referência documental ausente');
  if(ins===null||ins<0||!srcI)issue('INSAL_PENDENTE',it,d,c,'','Insalubridade sem comprovação explícita, inclusive quando o valor for zero');
  Q.set(key,{it,d,c,qtd,sal:sal!==null&&sal>=0&&srcS?sal:null,ins:ins!==null&&ins>=0&&srcI?ins:null});
 }
 total=[...Q.values()].reduce((a,x)=>a+x.qtd,0);
 if(total!==DP443.TOTAL)issue('ESCOPO_443','','','','','Soma oficial conferida = '+total+'; esperado = 443. Não presumir postos, não cortar a lista de funcionários e não tratar o quadro como completo.');
 const M=new Map(),amb=new Set();
 for(const x of dp443Rows(msh)){
  const orig=x.get('DEPARTAMENTO_ALTERDATA'),it=x.get('ITEM'),d=x.get('DEPARTAMENTO_OFICIAL'),k=dp443N(orig);
  if(!k)continue;
  if(!dp443Ok(x.get('CONFERIDO'))||!it||!d){issue('MAPA_PENDENTE',it,d,'','','Mapeamento não confirmado para '+orig);continue;}
  if(M.has(k)&&dp443K(M.get(k).it,M.get(k).d,'')!==dp443K(it,d,'')){amb.add(k);M.delete(k);issue('MAPA_AMBIGUO',it,d,'','','Mesmo departamento de origem associado a mais de um item/departamento oficial: '+orig);continue;}
  if(!amb.has(k))M.set(k,{it,d});
 }
 const canceled=new Set(dp443Rows(cancel).map(x=>dp443N(x.get('Nome','NOME COMPLETO','FUNCIONARIO','FUNCIONÁRIO'))).filter(Boolean));
 if(!canceled.size&&dp443Rows(cancel).length)issue('CANCELADOS_COLUNA','','','','','Não foi possível identificar a coluna Nome em Cancelados; verificar cabeçalho antes de confiar no quadro ativo.');
 const detail=[],active=new Map(),used=new Set();
 for(const x of dp443Rows(ativos)){
  const name=String(x.get('Nome','NOME COMPLETO','FUNCIONARIO','FUNCIONÁRIO')).trim();if(!name)continue;
  const n=dp443N(name);if(canceled.has(n))continue;
  if(used.has(n)){issue('NOME_DUPLICADO','','','',name,'Mais de um registro ativo com o mesmo nome; confirmar identidade. Registro adicional não contado.');continue;}used.add(n);
  const dept=x.get('Departamento','LOTAÇÃO','LOTACAO','UNIDADE'),cargo=x.get('Posto de Trabalho','FUNÇÃO','FUNCAO','CARGO'),salary=dp443Money(x.get('Salário Base','SALARIO BASE','SALÁRIO','SALARIO'));
  const alias=M.get(dp443N(dept));let it='',officialDept='',q=null,obs=[];
  if(!alias){obs.push('Departamento não mapeado');issue('DEPARTAMENTO_SEM_MAPA','',dept,cargo,name,'Cadastrar DE/PARA em MAPA_443');}
  else{it=alias.it;officialDept=alias.d;q=Q.get(dp443K(it,officialDept,cargo));if(!q){obs.push('Cargo/posto sem correspondência oficial');issue('POSTO_SEM_CORRESPONDENCIA',it,officialDept,cargo,name,'Verificar cargo, departamento, item e escopo da primeira leva');}}
  if(salary===null){obs.push('Salário ausente/inválido');issue('SALARIO_ALTERDATA_AUSENTE',it,officialDept,cargo,name,'Conferir salário na aba ALTERDATA');}
  let salStatus='PENDENTE';if(q&&q.sal!==null&&salary!==null){salStatus=Math.abs(salary-q.sal)<0.005?'🟢 CONFORME':'🔴 DIVERGENTE';if(salStatus.includes('DIVERGENTE'))issue('SALARIO_DIVERGENTE',it,officialDept,cargo,name,'ALTERDATA: '+salary+' | Edital: '+q.sal);}
  if(q&&q.ins===null)obs.push('Insalubridade oficial pendente');
  const status=!q||salary===null||q.sal===null||q.ins===null?'PENDENTE':salStatus.includes('DIVERGENTE')?'DIVERGENTE':'CONFORME';
  detail.push([name,officialDept||String(dept),it,cargo,salary===null?'':salary,q&&q.sal!==null?q.sal:'',salStatus,q&&q.ins!==null?q.ins:'',status,obs.join('; ')]);
  if(q){const k=dp443K(it,officialDept,cargo);if(!active.has(k))active.set(k,[]);active.get(k).push({name,salStatus});}
 }
 if(!dp443Rows(ativos).length)issue('ALTERDATA_VAZIA','','','','','Aba ALTERDATA sem registros identificáveis');
 const postRows=[];for(const [k,q] of Q){const people=active.get(k)||[],a=people.length,diff=a-q.qtd;
 const salStatus=people.some(p=>p.salStatus==='🔴 DIVERGENTE')?'🔴 DIVERGENTE':people.some(p=>p.salStatus==='PENDENTE')||q.sal===null?'PENDENTE':'🟢 CONFORME';
 const indicator=diff>0?'🔴 ↑ '+diff:diff<0?'🟠 ↓ '+Math.abs(diff):'🟢 ✓';
 const notes=[];if(diff>0)notes.push(diff+' funcionário(s) excedente(s)');if(diff<0)notes.push(Math.abs(diff)+' vaga(s) não preenchida(s)');if(total!==DP443.TOTAL)notes.push('Escopo oficial incompleto');if(q.ins===null)notes.push('Insalubridade pendente');
 postRows.push([q.it,q.d,q.c,q.qtd,a,diff,indicator,q.sal===null?'':q.sal,salStatus,q.ins===null?'':q.ins,notes.join('; ')]);
 }
 postRows.sort((a,b)=>dp443K(a[0],a[1],a[2]).localeCompare(dp443K(b[0],b[1],b[2])));
 detail.sort((a,b)=>dp443K(a[1],a[3],a[0]).localeCompare(dp443K(b[1],b[3],b[0])));
 dp443Write(post,DP443.HPOST,postRows);dp443Write(data,DP443.HPESS,detail);dp443Write(pend,DP443.HPEND,issues);
 post.getRange('H2:H').setNumberFormat('R$ #,##0.00');post.getRange('J2:J').setNumberFormat('R$ #,##0.00');
 data.getRange('E2:F').setNumberFormat('R$ #,##0.00');data.getRange('H2:H').setNumberFormat('R$ #,##0.00');
 dp443Dropdown(people,detail);dp443AplicarFiltro();
 SpreadsheetApp.getActive().toast('443 postos: '+postRows.length+' linhas oficiais, '+detail.length+' ativos identificados, '+issues.length+' pendências.','DP360',8);
 return {postos:postRows.length,ativos:detail.length,pendencias:issues.length,totalPrevistoConferido:total};
 }finally{if(lock)lock.releaseLock();}
}
function dp443PrepareDropdownIfMissing(sh){if(sh.getRange('A2').getValue()!=='DEPARTAMENTO:')sh.getRange('A2').setValue('DEPARTAMENTO:');sh.getRange('A4:J4').setValues([DP443.HPESS]).setFontWeight('bold').setBackground('#16365e').setFontColor('#ffffff');sh.setFrozenRows(4);}
function dp443Dropdown(sh,detail){const current=String(sh.getRange('B2').getValue()||'Todos'),list=['Todos',...new Set(detail.map(r=>String(r[1])).filter(Boolean))].sort((a,b)=>a==='Todos'?-1:b==='Todos'?1:a.localeCompare(b));sh.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list,true).setAllowInvalid(false).build());sh.getRange('B2').setValue(list.includes(current)?current:'Todos');}
function dp443AplicarFiltro(){const ss=SpreadsheetApp.getActiveSpreadsheet(),sh=dp443RequireSheet(ss,DP443.PESSOAS),data=dp443RequireSheet(ss,DP443.DADOS);const dept=dp443N(sh.getRange('B2').getValue()||'Todos'),all=dp443Rows(data).map(x=>x.r.slice(0,DP443.HPESS.length));const filtered=dept==='TODOS'?all:all.filter(r=>dp443N(r[1])===dept);dp443Write(sh,DP443.HPESS,filtered,5);sh.getRange('E5:F').setNumberFormat('R$ #,##0.00');sh.getRange('H5:H').setNumberFormat('R$ #,##0.00');sh.getRange('D2').setValue('Funcionários exibidos: '+filtered.length);}
function dp443FiltroEdit(e){if(!e||!e.range)return;if(e.range.getSheet().getName()===DP443.PESSOAS&&e.range.getA1Notation()==='B2')dp443AplicarFiltro();}
function dp443InstalarFiltro(){const ss=SpreadsheetApp.getActiveSpreadsheet();ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='dp443FiltroEdit').forEach(t=>ScriptApp.deleteTrigger(t));ScriptApp.newTrigger('dp443FiltroEdit').forSpreadsheet(ss).onEdit().create();}
