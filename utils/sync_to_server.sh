#!/bin/bash
echo $1

SSH_CONFIG_HOST="server-rsync"
DESTINATION_DIR="/root/vsheoran/git/test-appms/"

echo  $DESTINATION_DIR

SOURCE_DIR="/Users/vasusheoran/git/applicationsmicroservices"
SOURCE="$SOURCE_DIR/*"
EXCLUDE_GIT=".git"
EXCLUDE_APPMS_UI="appms-ui"

DESTINATION="$SSH_CONFIG_HOST:$DESTINATION_DIR"

# set -x
echo $DESTINATION


# rsync --delete --exclude "$EXCLUDE_GIT" --exclude "$EXCLUDE_APPMS_UI" --exclude "*/.DS_Store" --exclude "*/sc-hana-plugin/scc/" --exclude "*/ams_automation" --exclude "*/ANFStorage" --exclude "common.mk" --exclude "*/Makefile" -av --update $SOURCE $DESTINATION


# set -x


if [[ $1 == "-i" ]]
then
    echo "Fetching from $SERVER_IP"
    rsync -av --update --delete "$SSH_CONFIG_HOST:$DESTINATION_DIR" $SOURCE_DIR
else
    echo "Saving to $SERVER_IP"
    if [[ $2 = "-d" ]] | [[ $1 = "-d" ]] 
    then
        echo "With delete"
        rsync --delete --exclude "$EXCLUDE_GIT" --exclude "$EXCLUDE_APPMS_UI" --exclude "*/.DS_Store" --exclude "*/sc-hana-plugin/scc/"  -av --update $SOURCE $DESTINATION
    else
        echo "Without delete"
        rsync --exclude "$EXCLUDE_GIT" --exclude "$EXCLUDE_APPMS_UI" --exclude "*/.DS_Store" --exclude "*/sc-hana-plugin/scc/"  -av --update $SOURCE $DESTINATION
    fi
fi



# SOURCE='/Users/vasusheoran/OneDrive - NetApp Inc/SCS/samples/helm'
# DESTINATION="/root/vsheoran/git/helm"
# echo "$SOURCE:$DESTINATION"
# rsync --delete --exclude "*/charts"  -av --update "'"$SOURCE"'" $DESTINATION