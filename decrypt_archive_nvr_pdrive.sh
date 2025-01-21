#!/bin/bash

# Check if a file argument is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <encrypted_file>"
    exit 1
fi

# Input variables
ENCRYPTED_FILE="$1"  # The encrypted file passed as a command line argument
EXTRACT_ROOT="/home/tarik/Documents/nvr_archive_restore"
LOG_FILE="$EXTRACT_ROOT/decrypt_log.txt"

# create extract root folder
mkdir -p $EXTRACT_ROOT

# Function to log messages with timestamps
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Generate passphrase
PASSPHRASE=$(eval echo "$(pass nvr/archive_gpg)" | openssl dgst -sha256 | awk '{print $2}')
log "Generated passphrase."

# Check if the encrypted file exists
if [ ! -f "$ENCRYPTED_FILE" ]; then
    log "Error: Encrypted file '$ENCRYPTED_FILE' does not exist."
    exit 1
fi

# Step 1: Decrypt the file
DECRYPTED_FILE="$EXTRACT_ROOT/decrypted_$ENCRYPTED_FILE.tar.bz2"
log "Starting decryption of '$ENCRYPTED_FILE'."
if gpg2 --batch --yes --passphrase "$PASSPHRASE" -d "$ENCRYPTED_FILE" > "$DECRYPTED_FILE"; then
    log "Decryption successful: '$DECRYPTED_FILE'."
else
    log "Error occurred during decryption."
    exit 1
fi

# Step 2: Create extraction directory if it doesn't exist
EXTRACT_DIR="$EXTRACT_ROOT/${ENCRYPTED_FILE%.tar.bz2}"  # Remove extension for directory name
mkdir -p "$EXTRACT_DIR"

# Extract the tarball
log "Starting extraction of '$DECRYPTED_FILE' to '$EXTRACT_DIR'."
if tar xvjf "$DECRYPTED_FILE" -C "$EXTRACT_DIR"; then
    log "File successfully decrypted and extracted to '$EXTRACT_DIR'."
else
    log "Error occurred during extraction."
    exit 1
fi

log "Script completed successfully."

