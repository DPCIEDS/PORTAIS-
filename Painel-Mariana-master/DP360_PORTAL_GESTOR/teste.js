function mostrarConfigPortal() {
  const props = PropertiesService.getScriptProperties().getProperties();
  console.log(JSON.stringify(props, null, 2));
}