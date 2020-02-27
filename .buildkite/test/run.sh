#!/bin/bash

set -ex

npm i -g pnpm@4.9.3
pnpm i

pnpm run setup

pnpm run test
