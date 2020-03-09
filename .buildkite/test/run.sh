#!/bin/bash

set -ex

npm i -g node-pre-gyp
npm i -g sqlite3 --unsafe-perm
npm i -g pnpm@4.9.3
pnpm i

pnpm run setup

pnpm run test
