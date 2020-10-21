#!/usr/bin/env bash

# mkdir -p /tmp/test/
# cd /tmp/test/
# git init

# mkdir -p /tmp/test/image/1.0.0
# echo  'FROM python:3' > /tmp/test/image/1.0.0/Dockerfile
# mkdir -p /tmp/test/image/1.0.1
# touch 'FROM python:3' > /tmp/test/image/1.0.1/Dockerfile
# touch a > /tmp/test/image/1.0.1/c

# git add -A && git commit -m "save"
# deno run --allow-env --allow-read --allow-run --allow-net /workspaces/gitbuild/app.ts /tmp/test image

# tag status
# tag D B A 
# D delete
# B build
# A only alias


TEMP_FILES=/tmp/files
TEMP_TAGS=/tmp/tags
genFiles() {
	git log --pretty='' -1 -p --name-status HEAD -- $1 | while read line
	do
		local status=$(echo $line | cut -d$' ' -f1)
		if [[ $status == "R100" ]]; then
			echo $line | cut -d' ' -f3 >> $TEMP_FILES
		fi
		echo $line | cut -d' ' -f2 >> $TEMP_FILES
	done
}

genTags() {
	for file in `cat $TEMP_FILES`; do
		tag=$(echo $file | cut -d'/' -f2 >> $TEMP_FILES)

	  [ -d "/tmp/test/images/${tag}" ] && echo $tag >> $TEMP_TAGS_BUILD || echo $tag >> $TEMP_TAGS_DELETE
	done

}

# tagDirExist() {

# }
# genTags images
TEMP_TAGS_BUILD=/tmp/tags_builds
TEMP_TAGS_DELETE=/tmp/tags_deletes
for tag in `cat $TEMP_TAGS`; do
	[ -d "/tmp/test/images/${tag}" ] && echo $tag >> $TEMP_TAGS_BUILD || echo $tag >> $TEMP_TAGS_DELETE
done