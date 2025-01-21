#!/bin/bash

# Define the log file
LOGFOLDER="/home/tarik/tools/simple-nvr-gpu/log"
LOGFILE="$LOGFOLDER/archive_nvr_upload_pdrive.log"

# Define the directory to search
SEARCH_DIR="/home/tarik/Documents/nvr_backup"

# Get yesterday's date in YYYY-MM-DD format
YESTERDAY_DATE=$(date -d "yesterday" +'%Y-%m-%d_%H%M%S')

# Define the output tar.gz file name
OUTPUT_DIR="/home/tarik/Documents/nvr_archive/to_cloud"
OUTPUT_FILE="$OUTPUT_DIR/nvr_snapshot_$YESTERDAY_DATE.tar.bz2.gpg"

# Define the lock file
LOCK_FILE="$LOGFOLDER/rclone_sync.lock"

# Redirect stdout and stderr to include timestamps
exec > >(ts '[%Y-%m-%d %H:%M:%S]') 2>&1

{
    # make folder for log and lock file
    mkdir -p "$LOGFOLDER"

    # Acquire a lock to prevent concurrent execution
    flock -n 200 || { echo "[$(date +'%Y-%m-%d %H:%M:%S')] Script is already running."; exit 1; }

    # Redirect stdout and stderr to the log file with timestamps
    exec > >(tee -a "$LOGFILE" | ts '[%Y-%m-%d %H:%M:%S]') 2>&1

    # Enable command tracing
    set -x

    # Start of the script
    echo "Script started."

    # Check if the output directory exists
    if [ ! -d "$OUTPUT_DIR" ]; then
	echo "Output directory does not exist. Creating it..."
	mkdir -p "$OUTPUT_DIR"  # Create the directory, including parent directories as needed
	echo "Output directory created: $OUTPUT_DIR"
    else
	echo "Output directory already exists: $OUTPUT_DIR"
    fi

    ##############################
    # Find files and create tar.bz2
    # example decrypt : gpg2 -d --batch --passphrase "SECRET"  readme.md.t.gpg
    # gpg2 --batch --yes --passphrase "$PASSPHRASE" -d $FILE.tar.bzip2.gpg | tar xvf - -C /path/to/extract/directory --transform='s|^|output_filename/|'
    ##############################

    PASSPHRASE=$(eval echo "$(pass nvr/archive_gpg)" | openssl dgst -sha256 | awk '{print $2}')

    echo "Finding files modified yesterday and creating archive..."
    find "$SEARCH_DIR" -type f \
        -newermt "$(date -d 'yesterday 00:00' +'%Y-%m-%d %H:%M:%S')" \
        ! -newermt "$(date -d 'today 06:00' +'%Y-%m-%d %H:%M:%S')" \
        -print0 | tar --null -cvf - --files-from=- | pbzip2 -k -p4 -v -9 |  gpg2 -v -c --passphrase $PASSPHRASE --yes --quiet --batch > "$OUTPUT_FILE"

    if [ $? -eq 0 ]; then
        echo "Successfully created $OUTPUT_FILE containing files modified on $YESTERDAY_DATE."
    else
        echo "Error occurred while creating $OUTPUT_FILE."
        exit 1
    fi

    #####################
    # Upload to Proton Drive
    #####################
    DESTINATION_REMOTE="pdrive:Archive/nvr"
    CONF_PWD_CMD="pass rclone/config"

    # Check if OUTPUT_FILE exists before executing rclone
    if [ -f "$OUTPUT_FILE" ]; then
        echo "Starting copy from '$OUTPUT_FILE' to '$DESTINATION_REMOTE'..."
        
        rclone copy -vv  "$OUTPUT_FILE" "$DESTINATION_REMOTE" \
            --protondrive-replace-existing-draft=true \
            --password-command="$CONF_PWD_CMD"

        if [ $? -eq 0 ]; then
            echo "Sync from '$OUTPUT_FILE' to '$DESTINATION_REMOTE' completed successfully."

	    # Delete OUTPUT_FILE after successful sync
            rm -v "$OUTPUT_FILE"
            echo "Deleted output file: $OUTPUT_FILE"

        else
            echo "Error: Sync failed. Check the rclone output for details."
            exit 1
        fi
    else
        echo "Output file '$OUTPUT_FILE' does not exist. Skipping rclone upload."
    fi

    # End of the script
    echo "Script execution completed."

} 200>"$LOCK_FILE"

