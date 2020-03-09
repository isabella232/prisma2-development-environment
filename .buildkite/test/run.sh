#!/bin/bash

set -ex

npm i -g pnpm@4.9.3
pnpm i -g sqlite3 --unsafe-perm
pnpm i

pnpm run setup

pnpm run test
