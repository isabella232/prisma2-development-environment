#!/bin/bash

set -ex


npm i -g pnpm@next
npm i -g yarn || echo "Ok"
pnpm i

pnpm run setup

pnpm run test


echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc


pnpm run publish-all