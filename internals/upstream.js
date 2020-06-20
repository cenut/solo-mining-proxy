'use strict';
const rpcApi = require('./jsonrpc.js');

const { RpcConf } = require('../config.js');
const util = require('./util');

class Upstream {
    #client = null;

    constructor() {
        this.#client = new rpcApi(RpcConf);
    }

    getMiningInfo() {
        return new Promise((resolve, reject) => {
            this.#client.call({
                method: 'getmininginfo',
                params: []
            }, (error, data) => {
                if (error) return reject(error);
                return resolve(data.result);
            });
        });
    }

    getTemplate() {
        return new Promise((resolve, reject) => {
            this.#client.call({
                method: 'getblocktemplate',
                params: [{rules: ["segwit"]}]
            }, (error, data) => {
                if (error) return reject(error);
                return resolve(data.result);
            });
        });
    }

    longPoll(lpId) {
        return new Promise((resolve, reject) => {
            this.#client.call({
                method: 'getblocktemplate',
                params: [{rules: ["segwit"], longpollid: lpId}]
            }, (error, data) => {
                if (error) return reject(error);
                return resolve(data.result);
            });
        });
    }

    propose(data) {
        return new Promise((resolve, reject) => {
            this.#client.call({
                method: 'getblocktemplate',
                params: [ { mode : "proposal", rules : ["segwit"], data : data.toString('hex')} ]
            }, (error, data) => {
                if (error) return reject(error);
                return resolve(data.result);
            });
        });
    }

    submit(data) {
        return new Promise((resolve, reject) => {
            this.#client.call({
                method: 'submitblock',
                params: [ data.toString('hex') ]
            }, (error, data) => {
                if (error) return reject(error);
                return resolve(data.result);
            });
        });
    }
}


module.exports = Upstream;
