const channelID = '2749850'; 
const apiKey = 'KVO3EVHKEKJ9D78D'; 
const url = `https://api.thingspeak.com/channels/2749850/feeds/last.json?api_key=AKK112A0LNPRRW22`;


// Función para obtener el último dato
async function obtenerUltimoDato() {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error en la respuesta: ${response.status}`);
    }
    const data = await response.json();

    // Mostrar los datos obtenidos

    document.getElementById("HE").textContent = Math.trunc(data.field1) +' : '+ Math.trunc(data.field2) || 'No data';
    document.getElementById("HA").textContent = Math.trunc(data.field3) +' : '+ Math.trunc(data.field4) || 'No data';
    document.getElementById("HE2").textContent = Math.trunc(data.field5) +' : '+ Math.trunc(data.field6) || 'No data';
    document.getElementById("HA2").textContent = Math.trunc(data.field7) +' : '+ Math.trunc(data.field8) || 'No data';

  } catch (error) {
    console.error("Error al obtener el dato:", error);
  }
}

function sendData() {
    var apiKey = document.getElementById('apiKey').value;
    var horaEncendido = document.getElementById('horaEncendido').value;
    var minutoEncendido = document.getElementById('minutoEncendido').value;
    var horaApagado = document.getElementById('horaApagado').value;
    var minutoApagado = document.getElementById('minutoApagado').value;
    var horaEncendido_2 = document.getElementById('horaEncendido2').value;
    var minutoEncendido_2 = document.getElementById('minutoEncendido2').value;
    var horaApagado_2 = document.getElementById('horaApagado2').value;
    var minutoApagado_2 = document.getElementById('minutoApagado2').value;
    var url = 'https://api.thingspeak.com/update?api_key=' + apiKey +       
              '&field1=' + horaEncendido +
              '&field2=' + minutoEncendido +
              '&field3=' + horaApagado +
              '&field4=' + minutoApagado +
              '&field5=' + horaEncendido_2 +
              '&field6=' + minutoEncendido_2 +
              '&field7=' + horaApagado_2 +
              '&field8=' + minutoApagado_2;

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.send();

    xhr.onreadystatechange = function() {
        if (xhr.readyState == 4 && xhr.status == 200) {
            //alert('Datos enviados exitosamente');
            obtenerUltimoDato();
        }
    };
}

// Llama a la función
obtenerUltimoDato();