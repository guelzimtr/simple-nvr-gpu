#!/bin/bash

# Configuration variables
SOURCE_DIR="/home/tarik/Documents/nvr_backup"          # Directory to search for files
ARCHIVE_DIR="/home/tarik/Documents/nvr_archive"        # Directory to store the archived files
LOG_FILE="/home/tarik/tools/simple-nvr-gpu/log/simple-nvr_archive.log"       # Log file path
MODIFIED_DAYS="+90"                  # Files older than this many days will be archived
RETENTION_DAYS="15"                   # Retain archived files for this many days
DRY_RUN=false                         # Dry-run mode (set to true for simulation)

# Timestamp function for logging
timestamp() {
    date +"%Y-%m-%d %H:%M:%S"
}

# Logging function
log_message() {
    local message="$1"
    echo "$(timestamp) - $message" | tee -a "$LOG_FILE"
}

# Simulated actions for dry-run
perform_action() {
    local command="$1"
    if $DRY_RUN; then
        log_message "[DRY-RUN] Would execute: $command"
    else
	log_message "Executing command: $command"
	eval "$command >> $LOG_FILE 2>&1" 
    fi
}

# Parse command-line arguments
while [[ "$1" != "" ]]; do
    case $1 in
        --dry-run )
            DRY_RUN=true
            log_message "Dry-run mode enabled. No files will be moved or deleted."
            ;;
        * )
            log_message "ERROR: Unknown argument $1. Exiting."
            exit 1
            ;;
    esac
    shift
done

# Ensure required directories exist
if [[ ! -d "$SOURCE_DIR" ]]; then
    log_message "ERROR: Source directory $SOURCE_DIR does not exist. Exiting."
    exit 1
fi

mkdir -p "$ARCHIVE_DIR" || {
    log_message "ERROR: Failed to create archive directory $ARCHIVE_DIR. Exiting."
    exit 1
}

# Step 1: Find and archive files
log_message "Starting archiving process: Archiving files older than $MODIFIED_DAYS days..."
find "$SOURCE_DIR" -type f -mtime "$MODIFIED_DAYS" | while read -r file; do
    # Get the relative path of the file
    relative_path="${file#$SOURCE_DIR/}"
    # Create the same folder structure in the archive directory
    archive_folder="$ARCHIVE_DIR/$(dirname "$relative_path")"
    perform_action "mkdir -p \"$archive_folder\""
    # Move the file to the archive folder
    perform_action "mv \"$file\" \"$archive_folder/\"" && \
        log_message "Archived: $file -> $archive_folder" || \
        log_message "ERROR: Failed to move file $file to $archive_folder."
    
    # Update the timestamp of the archived file
    archived_file="$archive_folder/$(basename "$file")"
    perform_action "touch \"$archived_file\"" && \
        log_message "Timestamp updated for: $archived_file" || \
        log_message "ERROR: Failed to update timestamp for: $archived_file."
done

# Step 2: Cleanup archived files older than the retention period
log_message "Starting cleanup process: Deleting archived files older than $RETENTION_DAYS days..."
perform_action "find \"$ARCHIVE_DIR\" -type f -mtime \"+$RETENTION_DAYS\" -exec rm -vf {} \;" && \
    log_message "Cleanup completed successfully." || \
    log_message "ERROR: Failed during cleanup process."

# Step 3: Remove empty directories in the source directory
log_message "Removing empty directories in the source directory: $SOURCE_DIR..."
perform_action "find \"$SOURCE_DIR\" -type d -empty -exec rmdir -v {} \;" && \
    log_message "Empty directories in $SOURCE_DIR removed." || \
    log_message "ERROR: Failed to remove some empty directories in $SOURCE_DIR."

# Step 4: Remove empty directories in the archive directory
log_message "Removing empty directories in the archive directory: $ARCHIVE_DIR..."
perform_action "find \"$ARCHIVE_DIR\" -type d -empty -exec rmdir -v {} \;" && \
    log_message "Empty directories in $ARCHIVE_DIR removed." || \
    log_message "ERROR: Failed to remove some empty directories in $ARCHIVE_DIR."

log_message "Archiving and cleanup process completed."


