'use strict';

const net = require('net');

const util = require('./util.js');
const { diff1, Template } = require('./primitives.js');
const Upstream = require('./upstream');

class Counter {
    #seed = null;
    #counter = 0;

    constructor() {
        this.#seed = [util.randomBytes(8), util.packInt64LE(process.pid)];
    }

    next(len = 16) {
        return this.nextBin(len).toString('hex');
    }

    nextBin(len = 8) {
        let hash = util.sha256d(Buffer.concat([
            this.#seed[0],
            this.#seed[1],
            util.packInt64LE(this.#counter++)
        ]));

        return hash.slice(0, len);
    }
}

class StratumServer {
    #counter = new Counter();
    #shareTarget = diff1;
    #templates = [];

    #server = null;
    #port = 3333;
    #extraNonce1Len = 0;
    #extraNonce2Len = Template.extraNonceLen;

    #subscriptions = new Map();
    #authorized = new Map();
    #upstream = new Upstream;

    constructor(options, recipient) {
        if ((options.extraNonce1Len >= Template.extraNonceLen))
            throw 'Invalid extranonce size';
        this.#server = net.createServer(this.#handleConnection);

        this.#port = options.port;
        this.#counter = new Counter();
        this.#extraNonce1Len = options.extraNonce1Len;
        this.#extraNonce2Len = Template.extraNonceLen - options.extraNonce1Len;

        if (options.shareTarget) {
            this.#shareTarget = options.shareTarget;
        }

        this.#server.listen(this.#port, error => {
            if (error) {
                console.error("Unable to start server on: " + this.#port + " Message: " + error);
                return;
            }
            console.log("Started server on port: " + this.#port);
        });

        this.#pollRpc(recipient);
    }

    #pollRpc = async (recipient) => {

        let lpId;

        // Work update loop
        try {

            while (true) {
                const newTpl = (lpId === undefined) ? await this.#upstream.getTemplate() : await this.#upstream.longPoll(lpId);

                // Push job to clients
                const isNewTop = this.#pushJob(newTpl, recipient);

                if (isNewTop) {
                    // Report new top hash
                    console.log('Got prevhash %s from upstream', newTpl.previousblockhash);
                }

                // Keep longpollid
                lpId = newTpl.longpollid;

                if (!isNewTop) {
                    // hack for sudden drop of longpoll requests
                    await util.sleep(1000);
                }
            }
        } catch(e) {
            console.log('Error while processing new job data', e);
            process.exit(-1);
        }
    }

    #pushJob = (data, recipient) => {

        const isInit = (this.#templates.length === 0);
        const cleanjobs = isInit || (this.#templates.length > 120) || (this.#templates[this.#templates.length - 1].template.previousblockhash !== data.previousblockhash);

        if (!isInit && this.#templates[this.#templates.length - 1].jobid === data.longpollid) {
            // Duplicate push attempt
            return false;
        }

        if (cleanjobs) {
            this.#templates.length = 0;
        }

        let jobid = data.longpollid;
        let template = new Template(data, recipient, this.#counter.nextBin(8));
        this.#templates.push({ jobid: jobid, template: template });

        if (this.#authorized.size !== 0) {
            let job = [...template.getJobParams(jobid), cleanjobs];
            //console.log(job);
            console.log('Worker %d is broadcasting job %s to %d miners', process.pid, jobid, this.#authorized.size);
            for(const miner of this.#authorized.keys()) {
                // Broadcast jobs to authorized miners
                StratumServer.notify(miner, 'mining.notify', job);
            };
        }

        return isInit ? false : cleanjobs;
    }

    #sendjob = (miner, cleanjobs = false) => {
        if (this.#templates.length !== 0) {
            const { jobid, template } = this.#templates[this.#templates.length - 1];
            const job = [...template.getJobParams(jobid), cleanjobs];
            //console.log(job);
            StratumServer.notify(miner, 'mining.notify', job);
        }
    }

    #handleMessage = (miner, message) => {
        if (message.id === undefined || message.method === undefined || message.params === undefined) {
            console.warn('Malformed stratum request from ' + miner.remoteAddress);
            miner.destroy();
            return;
        }

        switch (message.method) {
            case 'mining.subscribe': {
                let [version, subscription] = message.params;
                if (subscription) {
                    // TODO: resume subscription
                }

                if (!this.#subscriptions.has(miner)) {
                    const subscriptionId = this.#counter.next();
                    this.#subscriptions.set(miner, subscriptionId);
                    StratumServer.reply(miner, message.id, null, [
                        [
                            ["mining.set_difficulty", subscriptionId],
                            ["mining.notify", subscriptionId]
                        ],
                        subscriptionId.slice(0, 2 * this.#extraNonce1Len),
                        this.#extraNonce2Len
                    ]);

                    console.log('Client %s reserves subscriptionId %s', miner.remoteAddress, subscriptionId);
                }
            }; break;
            case 'mining.authorize': {
                if (!this.#subscriptions.has(miner))
                    return StratumServer.reply(miner, message.id, 'You are not eligible to do such requests', null);
                const [user, password] = message.params;
                // Remember as authorized
                this.#authorized.set(miner, user);
                StratumServer.reply(miner, message.id, null, true);
                // Send difficulty and job
                StratumServer.notify(miner, 'mining.set_difficulty', [Number(diff1 / this.#shareTarget)]);
                if (this.#templates.length !== 0) {
                    this.#sendjob(miner, true);
                }
            }; break;
            case 'mining.get_transactions': {
                if (!this.#subscriptions.has(miner) || !this.#authorized.has(miner))
                    return StratumServer.reply(miner, message.id, 'You are not eligible to do such requests', null);
                let topJob = this.#templates[this.#templates.length - 1];
                if (!topJob)
                    return StratumServer.reply(miner, message.id, 'No job records in work log, please try again later', null);
                StratumServer.reply(miner, message.id, null, topJob.template.data);
            }; break;
            case 'mining.submit': {
                if (!this.#subscriptions.has(miner) || !this.#authorized.has(miner))
                    return StratumServer.reply(miner, message.id, 'You are not eligible to do such requests', null);
                const [user, jobid, extraNonce2, time, nonce] = message.params;
                const job = this.#templates.find(item => item.jobid == jobid);

                //console.log('mining.submit', jobid, job);

                if (!job) {
                    return StratumServer.reply(miner, message.id, 'Job not found', false);
                }

                // extraNonce1 is basically a beginning of subscriptionId
                const extraNonce1 = this.#subscriptions
                    .get(miner)
                    .slice(0, 2 * this.#extraNonce1Len);

                // New block header
                const header = job.template.serializeBlockHeader(extraNonce1, extraNonce2, time, nonce);

                if (job.template.target >= header.hashVal) {
                    // New block was found
                    const block = job.template.serializeBlock(extraNonce1, extraNonce2, time, nonce);

                    process.send({
                        sender: process.pid,
                        what: 'block',
                        data: {
                            coinbase: block.header.coinbase.toString('hex'),
                            header: block.header.hex,
                            hashBytes: Buffer.from(block.header.hashBytes).reverse().toString('hex'),
                            result: block.hex,
                            difficulty: Number(diff1 / block.header.hashVal),
                            needle: [
                                this.#authorized.get(miner),
                                extraNonce1,
                                extraNonce2,
                                time,
                                nonce,
                                job.template.randomId.toString('hex')
                            ]
                        }
                    });
                }
                else if (this.#shareTarget >= header.hashVal) {
                    // Report sub-target hash
                    process.send({
                        sender: process.pid,
                        what: 'share',
                        data: {
                            hashBytes: Buffer.from(header.hashBytes).reverse().toString('hex'),
                            difficulty: Number(diff1 / header.hashVal),
                            needle: [
                                this.#authorized.get(miner),
                                extraNonce1,
                                extraNonce2,
                                time,
                                nonce,
                                job.template.randomId.toString('hex')
                            ]
                        }
                    });
                } else {
                    // Hash is neither block nor sub-target solution, just a garbage
                    return StratumServer.reply(miner, message.id, 'high-hash', null);
                }

                // Successful solution verification
                StratumServer.reply(miner, message.id, null, true);
            }; break;
            default:
                StratumServer.reply(miner, message.id, 'Unknown stratum method', null);
        }
    }

    #handleConnection = (miner) => {
        miner.setKeepAlive(true);
        miner.setEncoding('utf8');

        let dataBuffer = '';

        miner.on('data', (chunk) => {
            dataBuffer += chunk;
            if (Buffer.byteLength(dataBuffer, 'utf8') > 8192) { // 8KB limit
                dataBuffer = null;
                if (this.#authorized.has(miner))
                    console.warn('Excessive packet size from miner %s (%s)', miner.remoteAddress, this.#authorized.get(miner));
                miner.destroy();
                return;
            }
            if (dataBuffer.indexOf('\n') !== -1) {
                let messages = dataBuffer.split('\n');
                let incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
                for (let i = 0; i < messages.length; i++) {
                    let message = messages[i];
                    if (message.trim() === '') {
                        continue;
                    }
                    let jsonData;
                    try {
                        jsonData = JSON.parse(message);
                    }
                    catch (e) {
                        if (this.#authorized.has(miner))
                            console.log("Malformed message from miner %s (%s)", miner.remoteAddress, this.#authorized.get(miner));
                        else if (this.#subscriptions.has(miner))
                            console.log("Malformed message from miner %s (%s)", miner.remoteAddress, this.#subscriptions.get(miner));
                        miner.destroy();
                        break;
                    }
                    this.#handleMessage(miner, jsonData);
                }
                dataBuffer = incomplete;
            }
        }).on('error', err => {
            if (err.code !== 'ECONNRESET') {
                if (this.#authorized.has(miner)) {
                    console.log('Socket error from miner %s (%s)', miner.remoteAddress, this.#authorized.get(miner));
                    console.log(err);
                } else if (this.#subscriptions.has(miner)) {
                    console.log('Socket error from miner %s (%s)', miner.remoteAddress, this.#subscriptions.get(miner));
                    console.log(err);
                }
            }
        }).on('close', () => {
            this.#subscriptions.delete(miner);
            this.#authorized.delete(miner);
        });
    }

    static notify(miner, method, params) {
        if (!miner.writable) {
            return;
        }
        let sendData = JSON.stringify({
            id: null,
            method: method,
            params: params
        }) + "\n";
        miner.write(sendData);
    }

    static reply(miner, id, error, result) {
        if (!miner.writable) {
            return;
        }
        let sendData = JSON.stringify({
            id: id,
            error: error ? { code: -1, message: error } : null,
            result: !error ? result : null
        }) + "\n";
        miner.write(sendData);
    }
}

module.exports = StratumServer;
