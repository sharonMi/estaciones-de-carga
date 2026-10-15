const channelID = '2450378'; 
const apiKey = 'YNVB6E1RE5FUI15H'; 
const url = `https://api.thingspeak.com/channels/2450378/feeds/last.json?api_key=117J62LLB2O5S7X5`;


// Función para obtener el último dato
async function obtenerUltimoDato() {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error en la respuesta: ${response.status}`);
    }
    const data = await response.json();

    // Mostrar los datos obtenidos
    /*console.log("Último dato del canal:");
    console.log(`Campo 1: ${data.field1}`);
    console.log(`Campo 2: ${data.field2}`);
    console.log(`Campo 3: ${data.field3}`);
    console.log(`Campo 4: ${data.field4}`);*/

    document.getElementById("tem").textContent = Math.trunc(data.field1*100)/100 +' ºC'|| 'No data';
    document.getElementById("humi").textContent = Math.trunc(data.field2*100)/100 +' %HR' || 'No data';
    document.getElementById("Co").textContent = Math.trunc(data.field3*100)/100 + ' ppm' || 'No data';
    document.getElementById("FFP").textContent = Math.trunc(data.field4*100)/100 + ' umol/m^2*s' || 'No data';
    document.getElementById("FFP2").textContent = Math.trunc(data.field5*100)/100 + ' umol/m^2*s' || 'No data';

  } catch (error) {
    console.error("Error al obtener el dato:", error);
  }
}

// Ejecutar la función cada 60 segundos (60000 milisegundos)
setInterval(obtenerUltimoDato, 60000);

// Llama a la función
obtenerUltimoDato();