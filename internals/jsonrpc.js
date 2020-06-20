// Derived from node-json-rpc-2

const https = require('https');
const http = require('http');
function getRandomId() {
    return parseInt(Math.random() * 100000);
}

class Client {
    #authNeeded = false;
    #protocol = 'http';
    #user = null;
    #password = null;
    #host = '127.0.0.1';
    #port = 8332;
    #agent = http;
    #path = '/';

    #authData = null;

    constructor(options) {
        options = options || {};
        if ('protocol' in options) this.#protocol = options.protocol;
        if ('user' in options) this.#user = options.user;
        if ('password' in options) this.#password = options.password;
        if ('host' in options) this.#host = options.host;
        if ('path' in options) this.#path = options.path;
        if ('port' in options && !isNaN(options.port)) this.#port = options.port;

        this.#agent = (this.#protocol === 'https') ?https: http;

        if (this.#user && this.#password) {
            this.#authNeeded = true;
            this.#authData = this.#user + ':' + this.#password;
        }
    }

    call(options, callback) {
        let requestData = Array.isArray(options) ? options.map(req => Client.parse(req)) : Client.parse(options);
        requestData = JSON.stringify(requestData);
        let requestOptions = {
            agent: this.#agent.globalAgent,
            method: 'POST',
            host: this.#host,
            port: this.#port,
            path: this.#path,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': (requestData).length
            }
        };

        if(this.#authNeeded) requestOptions.auth = this.#authData;

        let request = this.#agent.request(requestOptions);
        request.on('error', error => callback('error:', error));
        request.on('response', response => {
            let buffer = '';
            response.on('data', bytes => buffer += bytes );

            response.on('end', () => {
                let error = null, result = null, data = buffer;

                if (data.length > 0) {
                    try {
                        result = JSON.parse(data);
                    } catch (err) {
                        error = new Error('JSON deserialize error' + err);
                    }
                }

                if (response.statusCode == 200 || response.statusCode == 300) {
                    return callback(error, result);
                }

                if (result && 'error' in result) {
                    return callback(result.error, result);
                }

                callback(Client.status(response.statusCode), result);
            });
        });

        request.end(requestData);
    }

    static parse(options) {
        let {id, jsonrpc, method, params} = options;

        if (!method) {
            throw 'You didn\'t provide method name';
        }

        return { method: method, params: (params || []), jsonrpc: (jsonrpc || '2.0'), id: (id || getRandomId()) };
    }

    static status(code) {
        let codes = {
            200: '200 OK',
            300: '300 Multiple Choices',
            400: '400 Bad request',
            401: '401 Unauthorized',
            403: '403 Forbidden',
            404: '404 Not Found',
            405: '405 Method Not Allowed',
            407: '407 Proxy Authentication Required',
            408: '408 Request Timeout',
            451: '451 Unavailable For Legal Reasons',
            500: '500 Internal server error',
            501: '501 Not Implemented',
            502: '502 Bad Gateway',
            503: '503 Service Unavailable',
            504: '504 Gateway Timeout'
        };

        return codes[code] || ('Unhandled status code ' + code);
    }
}

module.exports = Client;
