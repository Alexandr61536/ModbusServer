const fs = require("fs");
const net = require("net");
const http = require("http");
const path = require("path");

class ModbusSlave {
    /**
     * ModbusSlave constructor
     * @constructor
     * @param {string} configPath - Path to config file
     * @param {string} tagsPath - Path to tags file
     */
    constructor(configPath, tagsPath) {
        this.configPath = configPath;
        this.config = this.loadConfig();
        this.tagsPath = tagsPath;
        this.tags = this.loadTags();
        this.sockets = [];

        this.startModbusServer();
        this.startWebView();
    }

    /**
     * @typedef {Object} ConfigData
     * @property {number} port Modbus slave port
     * @property {number} webViewPort Port of web view server
     * @property {string} logFilePath Path to log file
     */

    /**
     * Config file loader
     * @returns {ConfigData} Info from config file
     */
    loadConfig() {
        try {
            const configData = fs.readFileSync(this.configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            this.log("No config in directory, using defaults");
            const defaultConfig = {
                port: 502,
                webViewPort: 3000,
                logFilePath: "./log",
                id: 1,
            };
            this.saveConfig(defaultConfig);
            return defaultConfig;
        }
    }

    /**
     * Config file loader
     * @returns {number[]} tags Tags values
     */
    loadTags() {
        try {
            const configData = fs.readFileSync(this.tagsPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            this.log("No tags file in directory, using defaults");
            let defaultTags = Array(1000).fill(0);
            this.saveTags(defaultTags);
            return defaultTags;
        }
    }

    /**
     * Config file writer
     * @param {ConfigData} config Info for config file
     */
    saveConfig(config = null) {
        const configToSave = config || this.config;
        fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2));
    }

    /**
     * Tags file writer
     * @param {number[]} tags Tags values
     */
    saveTags(tags = []) {
        let tagsToWrite = this.tags || tags;
        fs.writeFileSync(this.tagsPath, JSON.stringify(tagsToWrite, null, 2));
    }

    /**
     * Logger
     * @param {string} message Message string
     * @param {boolean} debug Show only in debug mode
     */
    log (message, debug) {
        if (!this.config) return
        if (debug && !this.config.debug) return;
        const timestamp = (new Date()).toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        
        console.log(logMessage);

        fs.appendFileSync(this.config.logFilePath, logMessage + '\n');
    }

    /**
     * Methon for statics requests serving
     * @param {import('http').IncomingMessage} req Client request
     * @param {import('http').ServerResponse} res Server response
     */
    serveStatic(req, res) {
        const { method, url } = req;
        const FRONTEND_DIR = './frontend';

        if (url.startsWith('/api')) return;

        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpg',
            '.gif': 'image/gif',
            '.ico': 'image/x-icon'
        };

        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(FRONTEND_DIR, filePath);
        
        const extname = path.extname(filePath);
        const contentType = mimeTypes[extname] || 'text/plain';
        
        fs.readFile(filePath, (_, data) => {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    /**
     * Methon for API requests serving
     * @param {import('http').IncomingMessage} req Client request
     * @param {import('http').ServerResponse} res Server response
     */
    serveApi(req, res) {
        const { method, url } = req;

        if (method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
            return;
        }

        if (url.startsWith('/api')) {
            this.handleApiRequest(req, res);
            return;
        }
    }

    /**
     * Methon for API requests handling
     * @param {import('http').IncomingMessage} req Client request
     * @param {import('http').ServerResponse} res Server response
     */
    handleApiRequest(req, res) {
        const data = {
            tags: this.tags,
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    /**
     * Starts web view server
     */
    startWebView() {
        const PORT = this.config.webViewPort;

        const server = http.createServer((req, res) => {
            this.serveApi(req, res);
        
            this.serveStatic(req, res);
            
        });

        server.listen(PORT, () => {
            this.log(`Web view server running at ${PORT} port`);
        });
    }

    /**
     * Formes CRC-16 for message
     * @param {number[]} message Modbus PDU
     */
    CRC_16(message) {
        let crc = 0xFFFF;

        for (let i = 0; i < message.length; i++) {
            crc ^= message[i];
            
            for (let j = 0; j < 8; j++) {
                crc = crc & 0x0001 ? (crc >> 1) ^ 0xA001 : crc = crc >> 1;
            }
        }
        
        return crc;
    }

    /**
     * Checks CRC-16 of message
     * @param {number[]} message Modbus PDU
     * @param {number} crc CRC-16 of the message
     */
    validateCRC_16(message, crc) {
        return this.CRC_16(message) === crc;
    }

    /**
     * Modbus command builder
     * @param {number} slaveId Slave device ID
     * @param {number} functionId Function ID
     * @param {...*} args Function arguments
     */
    makePDU(slaveId, functionId, ...args) {
        const untypedArray = [
            slaveId,
            functionId
        ];

        for (let arg of args) {
            if (arg[1] === 1)
                untypedArray.push(arg[0]);
            if (arg[1] === 2)
                untypedArray.push(arg[0] >> 8, arg[0] &  255);
        }

        let data = new Uint8ClampedArray(untypedArray);

        let crc = this.CRC_16(data);

        untypedArray.push(crc & 255, crc >> 8);

        let PDU = new Uint8ClampedArray(untypedArray);

        return PDU;
    }

    /**
     * Modbus command parser
     * @param {number[]} PDU Modbus PDU
     */
    parsePDU(PDU) {
        let result = {
            slaveId:    PDU[0][0],
            functionId: PDU[1][0],
            data:       [],
        }

        let validatablePart = PDU.slice(0, PDU.length - 2).map(x=>x[0]);
        let data = PDU.slice(2, PDU.length - 2);
        let crc = (PDU[PDU.length - 1][0] << 8) + PDU[PDU.length - 2][0];

        for (let i in data) {
            // one-byte value
            if (data[i][1] === 0) result.data.push(data[i][0])
            // high-byte value
            if (data[i][1] === 1) result.data.push((data[i][0] << 8) + data[parseInt(i) + 1][0]);
            // low-byte value (already pushed)
            if (data[i][i] === 2) {}
        }

        if (this.validateCRC_16(validatablePart, crc)) {
            return result;
        }
        
        return null;
    }

    /**
     * Converts number to 16-number uppercase string
     * @param {number} number Source number
     */
    toHexString(number) {
        return number.toString(16).toUpperCase().padStart(2, 0);
    }

    /**
     * Converts Uint8ClampedArray to 16-number uppercase string array
     * @param {number[]} array Source Uint8ClampedArray
     */
    Uint8ClampedArrayToHexStringArray(array) {
        return Array.from(array).map(x=>this.toHexString(x));
    }

    /**
     * Starts Modbus server
     */
    startModbusServer() {
        this.server = net.createServer((socket)=>{
            this.sockets.push(socket);
            socket.on('data', (request)=>{
                if (Array.from(request)[0] === this.config.id)
                    socket.write(this.handleModbusRequest(Array.from(request)));
            })
            socket.on('end', () => {
                this.log('Client disconnected');
            });
            
            socket.on('error', (err) => {
                this.log('Socket error:', err.message);
            });
        })
        this.log(`Modbus server started on port ${this.config.port}`);
        this.server.listen(this.config.port, '127.0.0.1');

        process.on('SIGINT', async () => {
            this.log('\nReceived SIGINT (Ctrl+C)');
            await this.stopServer();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            this.log('Received SIGTERM');
            await this.stopServer();
            process.exit(0);
        });
    }

    /**
     * Stops Modbus server gracefully
     */
    stopServer() {
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }

            for (const socket of this.sockets) {
                socket.destroy();
            }
            this.sockets = [];

            this.server.close(() => {
                this.server = null;
                this.log('Server stopped gracefully');
                resolve();
            });
        });
    }

    /**
     * Modbus request handler
     * @param {number[]} request Modbus request
     * @returns 
     */
    handleModbusRequest(request) {
        if (request[1] === 0x03) return this.handle0x03Request(request);
        if (request[1] === 0x10) return this.handle0x10Request(request);
        return this.makeError(request, 1);
    }

    /**
     * Function 0x03 handler
     * @param {number[]} request Modbus request
     * @returns 
     */
    handle0x03Request(request) {
        this.log(`Request: ${this.Uint8ClampedArrayToHexStringArray(request).join(' ')}`);
        let refactoredData = [
            [request[0], 0],
            [request[1], 0],
            [request[2], 1],
            [request[3], 2],
            [request[4], 1],
            [request[5], 2],
            [request[6], 1],
            [request[7], 2],
        ]

        let data = this.parsePDU(refactoredData);

        if (!data) {
            this.log(`CRC invalid`);
            let errorMessage = this.makeError(request, 4);
            this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(errorMessage).join(' ')}`);
            return errorMessage;
        }

        if (data.data[0] > 999 || (data.data[0] + data.data[1] - 1) > 999) {
            this.log(`Out of range`);
            let errorMessage = this.makeError(request, 2);
            this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(errorMessage).join(' ')}`);
            return errorMessage;
        }

        let message = this.makePDU(
            data.slaveId, 
            data.functionId, 
            [data.data[1] * 2, 1],
            ...this.tags.slice(data.data[0], data.data[0] + data.data[1]).map(x => 
                [x, 2]
            )
        );
        this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(message).join(' ')}`);

        return message
    }

    /**
     * Function 0x10 handler
     * @param {number[]} request Modbus request
     * @returns 
     */
    handle0x10Request(request) {
        this.log(`Request: ${this.Uint8ClampedArrayToHexStringArray(request).join(' ')}`);
        let refactoredData = [
            [request[0], 0],
            [request[1], 0],
            [request[2], 1],
            [request[3], 2],
            [request[4], 1],
            [request[5], 2],
            [request[6], 0],
            ...request.slice(7).map((x, i)=>[x, (i % 2) + 1])
        ]

        let data = this.parsePDU(refactoredData);

        if (!data) {
            this.log(`CRC invalid`);
            let errorMessage = this.makeError(request, 4);
            this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(errorMessage).join(' ')}`);
            return errorMessage;
        }

        if (data.data[0] > 999 || (data.data[0] + data.data[1] - 1) > 999) {
            this.log(`Out of range`);
            let errorMessage = this.makeError(request, 2);
            this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(errorMessage).join(' ')}`);
            return errorMessage;
        }

        if (data.data[1] !== (data.data[2] / 2)) {
            this.log(`The number of tags does not match the number of bytes`);
            let errorMessage = this.makeError(request, 3);
            this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(errorMessage).join(' ')}`);
            return errorMessage;
        }

        if (data.data[1] !== data.data.length - 3) {
            this.log(`The number of tags does not match the number of values`);
            let errorMessage = this.makeError(request, 3);
            this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(errorMessage).join(' ')}`);
            return errorMessage;
        }

        for (let i = data.data[0]; i < (data.data[0] + data.data[1]); i++) {
            this.tags[i] = data.data[i - data.data[0] + 3];
        }

        this.saveTags();

        let response = this.makePDU(
            data.slaveId,
            data.functionId,
            [data.data[0], 2],
            [data.data[1], 2],
        )

        this.log(`Response: ${this.Uint8ClampedArrayToHexStringArray(response).join(' ')}`);

        return response;
    }

    /**
     * Creates response with error
     * @param {number[]} request Modbus request 
     * @param {*} errcode Error code
     * @returns 
     */
    makeError(request, errcode) {
        return this.makePDU(
            request[0],
            request[1] | 0b10000000,
            [errcode, 1]
        );
    }
}

const slave = new ModbusSlave('config.json', "tags.json");