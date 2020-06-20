# Solo mining proxy

This program provides you a possibility to run getblocktemplate-to-stratum proxy which is suitable for solo mining.

## Configuration

1. Run ```npm install``` to pull the dependencies, then update config.js file with proper RPC upstream endpoint information and replace recipient address with your own one. Note that ___only bech32 addresses___ are supported.

2. Optionally, you can change stratum server settings, such as listening port, extranonce size or solution difficulty.

3. To start the proxy server, run main.js file either directly using ```node main.js``` command or with your favorite supervisor.

4. Point your mining hardware to proxy endpoint e.g. 1.2.3.4:3333 where 1.2.3.4 is your server's IP address. User name and password are ignored so you can set them to arbitrary values.

## Configuration notes

If you're using Windows then please ensure that NodeJS installation directory path doesn't contain spaces. Otherwise you may expect ___unintended magical effects___.

## Dependencies

Works fine with NodeJS ___v12.x___ and newer.
You will need bigint-buffer and bech32 modules.
