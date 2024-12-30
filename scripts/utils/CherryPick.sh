#!/usr/bin/env bash

MASTER_COMMIT_ID=$1
REL_BRANCH=$2
#REL_BRANCH="NDAS_1.0"
FULL_REL_BRANCH="release/${REL_BRANCH}"

MASTER_SHORT_COMMIT_ID=`echo ${MASTER_COMMIT_ID} | cut -c 1-11`
TEMP_BRANCH="merge_${REL_BRANCH}_${MASTER_SHORT_COMMIT_ID}"

echo -e "\n***** Provided 'master' branch commit id: ${MASTER_COMMIT_ID}"
# echo "Short form of provided commit id: ${MASTER_SHORT_COMMIT_ID}"

# Switching to release 1.0 branch
git checkout master &> /dev/null
git pull -a
git checkout remotes/origin/${FULL_REL_BRANCH} &> /dev/null

# create new branch
git checkout -b ${TEMP_BRANCH} &> /dev/null
echo -e "\n***** Created a temporary local branch ${TEMP_BRANCH} from ${FULL_REL_BRANCH}"


# Switching to master branch
git checkout master &> /dev/null
git pull &> /dev/null

# Cherry picking only the fix
git checkout ${TEMP_BRANCH} &> /dev/null
git cherry-pick ${MASTER_COMMIT_ID} &> /dev/null

errorcode=$?

if [[ $errorcode == 0 ]] 
then
	echo -e "\n***** Cherry picked fix from ${MASTER_COMMIT_ID} to ${TEMP_BRANCH}"
else
	echo -e "\n***** Cherry pick failed with error code $errorcode, please manually try \ngit cherry-pick ${MASTER_COMMIT_ID}"
	exit $errorcode
fi

# Pushing the new branch to remote
git push origin ${TEMP_BRANCH} &> /dev/null
errorcode=$?

if [[ $errorcode == 0 ]]
then
	echo -e "\n***** You can create Pull Request from ${TEMP_BRANCH} to ${FULL_REL_BRANCH}"
else
	echo -e "\n***** Pushing ${TEMP_BRANCH} to remote failed with error code $errorcode, please manually try \ngit push origin ${TEMP_BRANCH}"
	exit $errorcode
fi
