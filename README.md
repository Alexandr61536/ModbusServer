# ModbusServer
## About
This program implements modbus server. It supports 0x03 and 0x10 functions for 1000 tags only. Journal is stored in logfile and web view lets monitoring tags state.
## Configuration
After the first start, the config file will be generated
- port - Port of the modbus server (default: 502)
- webViewPort - Port of the web view server (default: 3000)
- logFilePath - Path to the log file (default: ./log)
- id - Modbud server ID (default: 1)
## Running
`node index.js`
