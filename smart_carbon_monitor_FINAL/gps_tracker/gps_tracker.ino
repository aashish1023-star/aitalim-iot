#include <TinyGPS++.h>

TinyGPSPlus gps;

// UART2 -> GPS
HardwareSerial GPS(2);

// UART1 -> SIM800L
HardwareSerial SIM(1);

unsigned long lastSIMCheck = 0;
unsigned long lastGPSPrint = 0;

void sendAT(String cmd)
{
  Serial.println();
  Serial.print(">> ");
  Serial.println(cmd);

  SIM.println(cmd);

  unsigned long timeout = millis();

  while (millis() - timeout < 2000)
  {
    while (SIM.available())
    {
      Serial.write(SIM.read());
    }
  }
}

void setup()
{
  Serial.begin(115200);

  GPS.begin(9600, SERIAL_8N1, 16, 17);

  SIM.begin(9600, SERIAL_8N1, 26, 27);

  delay(3000);

  Serial.println();
  Serial.println("====================================");
  Serial.println("ESP32 GPS + SIM800L TEST");
  Serial.println("====================================");

  sendAT("AT");
  sendAT("ATE0");
}

void loop()
{

  // Read GPS continuously
  while (GPS.available())
  {
    gps.encode(GPS.read());
  }

  // Display GPS every 5 seconds
  if (millis() - lastGPSPrint > 5000)
  {
    lastGPSPrint = millis();

    Serial.println();
    Serial.println("------------- GPS -------------");

    if (gps.location.isValid())
    {
      Serial.print("Latitude : ");
      Serial.println(gps.location.lat(), 6);

      Serial.print("Longitude: ");
      Serial.println(gps.location.lng(), 6);

      Serial.print("Speed(km/h): ");
      Serial.println(gps.speed.kmph());

      Serial.print("Altitude(m): ");
      Serial.println(gps.altitude.meters());

      Serial.print("Satellites: ");
      Serial.println(gps.satellites.value());

      Serial.print("HDOP: ");
      Serial.println(gps.hdop.hdop());

      Serial.print("Date: ");
      Serial.print(gps.date.day());
      Serial.print("/");
      Serial.print(gps.date.month());
      Serial.print("/");
      Serial.println(gps.date.year());

      Serial.print("Time(UTC): ");
      Serial.print(gps.time.hour());
      Serial.print(":");
      Serial.print(gps.time.minute());
      Serial.print(":");
      Serial.println(gps.time.second());
    }
    else
    {
      Serial.println("No GPS Fix...");
      Serial.print("Satellites: ");
      Serial.println(gps.satellites.value());
    }
  }

  // Check SIM every 15 seconds
  if (millis() - lastSIMCheck > 15000)
  {
    lastSIMCheck = millis();

    Serial.println();
    Serial.println("------------- SIM800L -------------");

    sendAT("AT");
    sendAT("AT+CPIN?");
    sendAT("AT+CSQ");
    sendAT("AT+CREG?");
    sendAT("ATI");
  }

  // Manual AT Commands from Serial Monitor
  while (Serial.available())
  {
    SIM.write(Serial.read());
  }

  while (SIM.available())
  {
    Serial.write(SIM.read());
  }
}