'use strict';

const crypto = require('crypto');
const bb = require('bigint-buffer');
const bech32 = require('bech32');

exports.randomBytes = crypto.randomBytes;

exports.sha256 = function (buffer) {
    let hash1 = crypto.createHash('sha256');
    hash1.update(buffer);
    return hash1.digest();
};

exports.sha256d = function (buffer) {
    return exports.sha256(exports.sha256(buffer));
};

exports.serializeNumber = function (n) {
    /**
     * "serialized CScript" formatting as defined here:
     * https://github.com/bitcoin/bips/blob/master/bip-0034.mediawiki#specification
     * Used to format height and date when putting into script signature:
     * https://en.bitcoin.it/wiki/Script
     */

    if (n >= 1 && n <= 16) return Buffer.from([0x50 + n]);
    let l = 1;
    let buff = Buffer.alloc(9);
    while (n > 0x7f) {
        buff.writeUInt8(n & 0xff, l++);
        n >>= 8;
    }
    buff.writeUInt8(l, 0);
    buff.writeUInt8(n, l++);
    return buff.slice(0, l);
};

exports.serializeString = function (s) {
    /**
     * Used for serializing strings used in script signature
     */

    if (s.length < 253)
        return Buffer.concat([
            Buffer.from([s.length]),
            Buffer.from(s)
        ]);
    else if (s.length < 0x10000)
        return Buffer.concat([
            Buffer.from([253]),
            exports.packUInt16LE(s.length),
            Buffer.from(s)
        ]);
    else if (s.length < 0x100000000)
        return Buffer.concat([
            Buffer.from([254]),
            exports.packUInt32LE(s.length),
            Buffer.from(s)
        ]);
    else
        return Buffer.concat([
            Buffer.from([255]),
            exports.packUInt16LE(s.length),
            Buffer.from(s)
        ]);
};

exports.packUInt16LE = function (num) {
    let buff = Buffer.alloc(2);
    buff.writeUInt16LE(num, 0);
    return buff;
};

exports.packUInt16BE = function (num) {
    let buff = Buffer.alloc(2);
    buff.writeUInt16BE(num, 0);
    return buff;
}

exports.packInt32LE = function (num) {
    let buff = Buffer.alloc(4);
    buff.writeInt32LE(num, 0);
    return buff;
};
exports.packInt32BE = function (num) {
    let buff = Buffer.alloc(4);
    buff.writeInt32BE(num, 0);
    return buff;
};
exports.packUInt32LE = function (num) {
    let buff = Buffer.alloc(4);
    buff.writeUInt32LE(num, 0);
    return buff;
};
exports.packUInt32BE = function (num) {
    let buff = Buffer.alloc(4);
    buff.writeUInt32BE(num, 0);
    return buff;
};
exports.packInt64LE = function (num) {
    let buff = Buffer.alloc(8);
    buff.writeUInt32LE(num % Math.pow(2, 32), 0);
    buff.writeUInt32LE(Math.floor(num / Math.pow(2, 32)), 4);
    return buff;
};

exports.varIntBuffer = function (n) {
    /*
     * Defined in bitcoin protocol here:
     * https://en.bitcoin.it/wiki/Protocol_specification#Variable_length_integer
     */

    if (n < 0xfd)
        return Buffer.from([n]);
    else if (n <= 0xffff) {
        let buff = Buffer.alloc(3);
        buff[0] = 0xfd;
        buff.writeUInt16LE(n, 1);
        return buff;
    }
    else if (n <= 0xffffffff) {
        let buff = Buffer.alloc(5);
        buff[0] = 0xfe;
        buff.writeUInt32LE(n, 1);
        return buff;
    }
    else {
        let buff = Buffer.alloc(9);
        buff[0] = 0xff;
        exports.packUInt16LE(n).copy(buff, 1);
        return buff;
    }
};

exports.varStringBuffer = function (string) {
    let strBuff = Buffer.from(string);
    return Buffer.concat([exports.varIntBuffer(strBuff.length), strBuff]);
};

/*
An exact copy of python's range feature. Written by Tadeck:
 http://stackoverflow.com/a/8273091
 */
exports.range = function (start, stop, step) {
    if (typeof stop === 'undefined') {
        stop = start;
        start = 0;
    }
    if (typeof step === 'undefined') {
        step = 1;
    }
    if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
        return [];
    }
    let result = [];
    for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
        result.push(i);
    }
    return result;
};

exports.revertBuffer = function (buf) {
    return Buffer.from(buf).reverse();
};

exports.revertByteOrder = function (buff) {
    for (let i = 0; i < 8; ++i)
        buff.writeUInt32LE(buff.readUInt32BE(i * 4), i * 4);
    return exports.revertBuffer(buff);
};

exports.revertBuffers = function (buffers) {
    return buffers.map(buf => exports.revertBuffer(buf));
};

exports.revertHex = function (hex) {
    return Buffer.from(hex, 'hex').reverse().toString('hex');
}

// https://en.bitcoin.it/wiki/Difficulty#How_is_difficulty_stored_in_blocks.3F
exports.bignumFromBitsHex = function (bitsHex) {
    let numBytes = BigInt('0x' + bitsHex.slice(0, 2));
    let bigBits = BigInt('0x' + bitsHex.slice(2));

    return bigBits * 2n ** (8n * (numBytes - 3n));
};

exports.toBigIntLE = bb.toBigIntLE;

exports.toBigIntHex = function (hex) {
    return bb.toBigIntBE(Buffer.from(hex, 'hex'));
}

exports.addressToScript = function (addr) {
    const data = bech32.decode(addr);
    if (data.prefix.indexOf('rubtc') !== 0)
       throw new Error('Invalid bech32 prefix');
    const payload = data.words.slice(1);
    const hash = Buffer.from(bech32.fromWords(payload));

    // Create output script
    let script = Buffer.allocUnsafe(hash.length + 2);
    script[0] = 0x00;
    script[1] = hash.length;
    hash.copy(script, 2);

    return script;
};

exports.sleep = function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
