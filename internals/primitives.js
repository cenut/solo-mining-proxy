'use strict';

const util = require('./util.js');

const watermark = '/Eru Ilúvatar/'
const diff1 = BigInt('0x00000000ffff0000000000000000000000000000000000000000000000000000');
const zeroHash = Buffer.alloc(32);

class MerkleTree {
    #steps = null;

    // Init
    constructor(data) {
        // https://en.bitcoin.it/wiki/Protocol_documentation#Merkle_Trees
        this.#steps = MerkleTree.calculateSteps(data);
    };

    withFirst(f) {
        this.#steps.forEach(function (s) {
            f = util.sha256d(Buffer.concat([f, s]));
        });
        return f;
    };

    getMerkleHashes() {
        return this.#steps.map(function (step) {
            return step.toString('hex');
        });
    };

    static merkleJoin(h1, h2) {
        let joined = Buffer.concat([h1, h2]);
        let dhashed = util.sha256d(joined);
        return dhashed;
    };

    static calculateSteps(data) {
        let L = data;
        let steps = [];
        let PreL = [null];
        let StartL = 2;
        let Ll = L.length;

        if (Ll > 1) {
            while (true) {

                if (Ll === 1)
                    break;

                steps.push(L[1]);

                if (Ll % 2)
                    L.push(L[L.length - 1]);

                let Ld = [];
                let r = util.range(StartL, Ll, 2);
                r.forEach(function (i) {
                    Ld.push(MerkleTree.merkleJoin(L[i], L[i + 1]));
                });
                L = PreL.concat(Ld);
                Ll = L.length;
            }
        }
        return steps;
    }
};

class Template {

    #bits = 0;
    #coinbasevalue = 0;
    #curtime = 0;
    #height = 0;
    #previousblockhash = '';
    #version = null;
    #witness_commitment = '';

    #gen1 = null;
    #gen2 = null;
    #merkleTree = [];
    #target = 0n;
    #data = [];
    #hashes = [];
    #randomId = null;

    constructor(tpl, recipient, randId) {
        // Sanity checks
        if (!recipient) throw new Error('Recipient is not available');
        if (!randId) throw new Error('randId is not available');
        if (!tpl.default_witness_commitment) throw new Error('Upstream didn\'t provide witness commitment hash');

        this.#version = tpl.version;
        this.#previousblockhash = tpl.previousblockhash;
        this.#target = util.bignumFromBitsHex(tpl.bits);
        this.#curtime = tpl.curtime;
        this.#bits = tpl.bits;
        this.#height = tpl.height;

        this.#coinbasevalue = tpl.coinbasevalue;
        this.#hashes = tpl.transactions
            .map(tx => tx.txid || tx.hash)
            .map(hash => Buffer.from(hash, 'hex'));
        this.#data = tpl.transactions
            .map(tx => Buffer.from(tx.data, 'hex'));
        this.#merkleTree = new MerkleTree([null].concat(util.revertBuffers(this.#hashes)));
        this.#witness_commitment = tpl.default_witness_commitment;

        Template.initGenTx(this, recipient, randId);
    };

    static get extraNonceLen() {
        return 8;
    }

    get coinbasevalue() {
        return this.#coinbasevalue;
    }

    get curtime() {
        return this.#curtime;
    }

    get difficulty() {
        return diff1 / this.#target;
    }

    get previousblockhash() {
        return this.#previousblockhash;
    }

    get target() {
        return this.#target;
    }

    get data() {
        return this.#data.map(tx => tx.toString('hex')); 
    }

    get randomId() {
        return this.#randomId;
    }

    serializeBlockHeader (extraNonce1, extraNonce2, time, nonce) {
        const coinbase = Buffer.from(this.#gen1 + extraNonce1 + extraNonce2 + this.#gen2, 'hex');

        // https://en.bitcoin.it/wiki/Protocol_specification#Block_Headers
        const coinbaseHash = util.sha256d(coinbase);
        const merkleRoot = this.#merkleTree.withFirst(coinbaseHash).reverse().toString('hex');
        let header = Buffer.allocUnsafe(80);
        let position = 0;
        header.write(nonce, position, 4, 'hex');
        header.write(this.#bits, position += 4, 4, 'hex');
        header.write(time, position += 4, 4, 'hex');
        header.write(merkleRoot, position += 4, 32, 'hex');
        header.write(this.#previousblockhash, position += 32, 32, 'hex');
        header.writeUInt32BE(this.#version, position + 32);
        header.reverse();

        const hash = util.sha256d(header);

        return { data: header, hex: header.toString('hex'), hashBytes: hash, hashVal: util.toBigIntLE(hash), coinbase: coinbase };
    }
    
    serializeBlock (extraNonce1, extraNonce2, time, nonce) {
        const header = this.serializeBlockHeader(extraNonce1, extraNonce2, time, nonce);
        const block = Buffer.concat([
            header.data,
            util.varIntBuffer(this.#hashes.length + 1),
            Template.segwitify(header.coinbase),
            Buffer.concat(this.#data)
        ]);

        return { data: block, hex: block.toString('hex'), header: header };
    }

    getJobParams (jobId) {
        const prevHashReversed = util.revertByteOrder(Buffer.from(this.#previousblockhash, 'hex')).toString('hex');

        return [
            jobId,
            prevHashReversed,
            this.#gen1,
            this.#gen2,
            this.#merkleTree.getMerkleHashes(),
            util.packInt32BE(this.#version).toString('hex'),
            this.#bits,
            util.packUInt32BE(this.#curtime).toString('hex')
        ];
    }

    static initGenTx (tpl, recipient, randId){
        const txInputsCount = 1;
        const txVersion = 1;
        const txLockTime = 0;
    
        const txInPrevOutHash = zeroHash;
        const txInPrevOutIndex = 2**32 - 1;
        const txInSequence = 0;
    
        const scriptSigPart1 = Buffer.concat([
            util.serializeNumber(tpl.#height),
            util.serializeString(randId),
            util.varIntBuffer(this.extraNonceLen)
        ]);

        const scriptSigPart2 = util.serializeString(watermark);
    
        const p1 = Buffer.concat([
            util.packUInt32LE(txVersion),
            util.varIntBuffer(txInputsCount),
            txInPrevOutHash,
            util.packUInt32LE(txInPrevOutIndex),
            util.varIntBuffer(scriptSigPart1.length + this.extraNonceLen + scriptSigPart2.length),
            scriptSigPart1
        ]);
    
        const p2 = Buffer.concat([
            scriptSigPart2,
            util.packUInt32LE(txInSequence),
            util.varIntBuffer(2),
            util.packInt64LE(tpl.#coinbasevalue),
            util.varIntBuffer(recipient.length),
            recipient,
            util.packInt64LE(0),
            util.varIntBuffer(tpl.#witness_commitment.length / 2),
            Buffer.from(tpl.#witness_commitment, 'hex'),
            util.packUInt32LE(txLockTime)
        ]);

        tpl.#randomId = randId;
        tpl.#gen1 = p1.toString('hex');
        tpl.#gen2 = p2.toString('hex');
    };

    static segwitify(tx) {
        // Segwit marker and flag
        let witnessFlags = util.packUInt16LE(0x0100);
    
        // coinbase scriptWitness
        let witnessData = Buffer.concat([
            // One empty entry, 32 bytes long
            util.varIntBuffer(0x01),
            util.varIntBuffer(0x20),
            Buffer.alloc(32)
        ]);
    
        let tmp = Buffer.allocUnsafe(tx.length + witnessFlags.length + witnessData.length);
    
        // Copy original data
        tx.copy(tmp, 0, 0, 4);
        tx.copy(tmp, 6, 4, tx.length - 4);
        tx.copy(tmp, tmp.length - 4, tx.length - 4);
    
        // Add segwit data
        witnessFlags.copy(tmp, 4);
        witnessData.copy(tmp, tmp.length - (4 + witnessData.length));
    
        return tmp;
    }
}

module.exports.Template = Template;
module.exports.diff1 = diff1;
