function downloadCSV() {
    const canales = [
    { id: '2450378', apiKey: 'YNVB6E1RE5FUI15H', nombre: 'canal1.csv' },
    { id: '2743619', apiKey: 'HSRY4D6ZEWUSXN79', nombre: 'canal2.csv' }
  ];
  const results = 3600;

  // Descarga cada canal secuencialmente
  canales.reduce((prevPromise, c) => {
    return prevPromise.then(() => {
      const url = `https://api.thingspeak.com/channels/${c.id}/feeds.csv?results=${results}${c.apiKey ? '&api_key=' + c.apiKey : ''}`;

      return fetch(url)
        .then(resp => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status} canal ${c.id}`);
          return resp.text();
        })
        .then(csvText => {
          const blob = new Blob([csvText], { type: 'text/csv' });
          const href = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = href;
          a.download = c.nombre;
          document.body.appendChild(a);
          a.click();

          setTimeout(() => {
            URL.revokeObjectURL(href);
            a.remove();
          }, 2000);

          // Pausa antes de la siguiente descarga
          return new Promise(r => setTimeout(r, 700));
        });
    });
  }, Promise.resolve())
  .catch(e => {
    console.error('Error descargando CSV:', e);
    alert('Hubo un problema al descargar. Mira la consola.');
  });
}