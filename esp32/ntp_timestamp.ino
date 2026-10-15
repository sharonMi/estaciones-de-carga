// Fragmento para el ESP32: sincroniza el reloj por NTP antes de enviar datos
// y adjunta la marca de tiempo UTC de la medición a ThingSpeak (parámetro created_at).
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

const char* NTP_1 = "pool.ntp.org";
const char* NTP_2 = "time.google.com";
const char* NTP_3 = "time.cloudflare.com";

void syncClock() {
  configTime(0, 0, NTP_1, NTP_2, NTP_3);   // trabajar siempre en UTC
  struct tm t;
  while (!getLocalTime(&t, 10000)) {
    Serial.println("Esperando hora NTP...");
  }
  Serial.println(&t, "Hora UTC sincronizada: %Y-%m-%dT%H:%M:%SZ");
}

// ISO 8601 en UTC, p. ej. 2026-10-15T12:44:00Z
String utcTimestamp() {
  time_t now = time(nullptr);
  struct tm t;
  gmtime_r(&now, &t);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

void sendReading(const char* writeKey, float v, float i, float p, float e, float f, float pf) {
  String url = String("https://api.thingspeak.com/update?api_key=") + writeKey +
               "&field1=" + v + "&field2=" + i + "&field3=" + p +
               "&field4=" + e + "&field5=" + f + "&field6=" + pf +
               "&created_at=" + utcTimestamp();
  HTTPClient http;
  http.begin(url);
  int code = http.GET();          // responde con el entry_id (0 = rechazado)
  Serial.printf("ThingSpeak %d: %s\n", code, http.getString().c_str());
  http.end();
}

// En setup(): conectar WiFi y llamar syncClock().
// El ESP32 resincroniza por NTP automáticamente cada hora (SNTP).
