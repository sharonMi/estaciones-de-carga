function downloadCSV() {
      const channelID = '2291469';
      const apiKey = 'GRXEVY8EJR76BG9T'; 
      const results = 5040;

      const url = `https://api.thingspeak.com/channels/${channelID}/feeds.csv?results=${results}${apiKey ? '&api_key=' + apiKey : ''}`;

      // Crear enlace para descarga
      const link = document.createElement("a");
      link.href = url;
      link.download = "datos_thingspeak.csv"; // nombre del archivo
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
}