#!/usr/bin/env node
'use strict';

const Upstream = require('./internals/upstream');
const { fork } = require('child_process');

function timestamp() {
    return new Date().toLocaleString();
}


(async () => {
    let upstream = new Upstream;

    try {
        // Check RPC
        console.log('Testing RPC connection...');
        const miningInfo = await upstream.getMiningInfo();
        console.log('RPC connection successful, block height %d mining difficulty %s', miningInfo.blocks, miningInfo.difficulty);
    } catch(e) {
        console.log('Error while testing upstream connection', e);
        process.exit(-1);
    }

    // Start stratum workers
    const clients = fork('./stratum_workers.js');

    // Solution messages handler
    clients.on('message', async msg => {
        if (msg.what === 'share') {
            let { coinbase, header, hashBytes, difficulty } = msg.data;
            let [user, extraNonce1, extraNonce2, time, nonce, randomId] = msg.data.needle;

            // Report solution info
            console.log('[%s] Got sub-target hash %s from %s with difficulty %s', timestamp(), hashBytes, user, difficulty);
        }

        if (msg.what === 'block') {
            let { result, coinbase, header, hashBytes, difficulty } = msg.data;
            let [user, extraNonce1, extraNonce2, time, nonce, randomId] = msg.data.needle;

            // Report solution info
            console.log('[%s] Got solution hash %s from %s with difficulty %s', timestamp(), hashBytes, user, difficulty);
            console.log('Solution data: ExtraNonce1 %s, ExtraNonce2 %s, time %s, nonce %s, randomId %s', extraNonce1, extraNonce2, time, nonce, randomId);
            console.log('Solution header hash: %s', hashBytes);
            console.log('Reconstructed coinbase %s', coinbase);
            console.log('Reconstructed block header %s', header);

            try {
                // Submitting block to upstream
                const res = await upstream.submit(result);
                if (res !== null)
                    return console.log('[%s] block solution with difficulty %s from %s has been rejected by bitcoind: %s', timestamp(), difficulty, user, res);
                console.log('[%s] block solution with difficulty %s from %s has been accepted by bitcoind', timestamp(), difficulty, user);
            } catch (e) {
                console.log('Error while sending solution to upstream', e);
                process.exit(-1);
            }
        }
    });

})();
