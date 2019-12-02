#!/bin/bash

set -ex

npm i -g pnpm yarn
pnpm i

pnpm run setup

pnpm run test

pnpm run publish-all