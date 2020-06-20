'use strict';

const { diff1 }  = require('./internals/primitives.js');

module.exports.RpcConf = {
    host: '127.0.0.1',
    port: 7332,
    user: 'rpcuser',
    password: 'rpcpassword'
};

module.exports.StratumConf = {
    port: 3333,
    extraNonce1Len: 4,
    shareTarget: diff1 / 16384n
};

module.exports.Recipient = 'rubtcm1qerzu8z5hggxxk0hcqgn2qflw07l94pu6mt8crv';
