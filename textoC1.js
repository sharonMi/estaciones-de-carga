const channelID = '2291469'; 
const apiKey = 'GRXEVY8EJR76BG9T'; 
const url = `https://api.thingspeak.com/channels/2291469/feeds/last.json?api_key=I8616IDWH0PFDTSB`;


// Función para obtener el último dato
async function obtenerUltimoDato() {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error en la respuesta: ${response.status}`);
    }
    const data = await response.json();

    document.getElementById("tem").textContent = Math.trunc(data.field1*100)/100 +' ºC'|| 'No data';
    document.getElementById("humi").textContent = Math.trunc(data.field2*100)/100 +' %HR' || 'No data';
    document.getElementById("Co").textContent = Math.trunc(data.field3*100)/100 + ' ppm' || 'No data';
    document.getElementById("FFP").textContent = Math.trunc(data.field4*100)/100 + ' umol/m^2*s' || 'No data';

  } catch (error) {
    console.error("Error al obtener el dato:", error);
  }
}

// Ejecutar la función cada 60 segundos (60000 milisegundos)
setInterval(obtenerUltimoDato, 60000);

// Llama a la función
obtenerUltimoDato();