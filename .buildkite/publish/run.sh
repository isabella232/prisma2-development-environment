#!/bin/bash

set -ex

echo $NPM_TOKEN
echo $GITHUB_TOKEN


npm i -g pnpm yarn
pnpm i

pnpm run setup

pnpm run test


echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc


pnpm run publish-all