#!/bin/bash
SSH_CONFIG_HOST="server-rsync"

set -x
rsync -av --update /Users/vasusheoran/.alias $SSH_CONFIG_HOST:/u/vsheoran/alias
rsync -av --update /Users/vasusheoran/.snapcenter $SSH_CONFIG_HOST:/u/vsheoran/snapcenter
  