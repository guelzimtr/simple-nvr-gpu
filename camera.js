const childProcess = require("child_process");
const path = require("path");
const fs = require('fs');
const fsAsync = require('fs').promises;
var CronJob = require('cron').CronJob;

const storage = require('./storage.json');
const cameraConfigs = require('./cameras.json');
const videoConcatinator = require('./video-concat.js');

const videoLengthSeconds = 300; // 5 mins
const timeoutRecordingWatcher = 1000 * 310; // 5 minutes 10 seconds - increased due to mkv files not triggering changes as frequently
const cameras = [];

module.exports.initCameras = () => {
    for (let i = 0; i < cameraConfigs.length; i++) {
        const cameraConfig = cameraConfigs[i];
        const camera = new CameraStream(cameraConfig.name, cameraConfig.url);
        cameras.push(camera);
    }
}

class CameraStream {
    constructor(name, url) {
	
	
	this.name = name;
        this.log(`Initialising camera...`);

        this.url = url;
        this.storagePath = path.join(storage.rootpath, this.name);
        this.rawStoragePath = path.join(this.storagePath, 'raw');
        this.localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        fs.mkdirSync(this.rawStoragePath, { recursive: true });

        this.ffmpegProcess = null;
        this.recordingWatcher = null;
	this.deleteOldRecordingsProcess = null;
	this.deleteEmptyFoldersProcess = null;

	if(storage.hevc_vaapi){
		this.log("HEVC VAAPI GPU encoding...");
		this.args = [
			            "-hide_banner",
			            "-y", // overwrite files without asking
			            "-loglevel", "error",
			            "-rtsp_transport", "tcp",
			            "-use_wallclock_as_timestamps", "1", // Fix the timestamps in the file not being correct
			            "-hwaccel", "vaapi",
				    "-hwaccel_output_format", "vaapi",
			            "-i", this.url,
			            "-c:v", "hevc_vaapi",
			            "-qp", "30",
			            "-c:a", "copy",
			            "-f", "segment",
			            "-reset_timestamps", "1",
			            "-segment_time", `${videoLengthSeconds}`,
			            "-segment_format", "mkv",
			            "-segment_atclocktime", "1",
			            "-strftime", "1",
			            `${path.join(this.rawStoragePath, "%Y-%m-%dT%H %M %S%z.mkv")}`
			        ];

	} else {
		this.log("CPU x264 encoding...");

        this.args = [
            "-hide_banner",
            "-y", // overwrite files without asking
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-use_wallclock_as_timestamps", "1", // Fix the timestamps in the file not being correct
            "-i", this.url,
            "-vcodec", "copy",
            "-f", "segment",
            "-reset_timestamps", "1",
            "-segment_time", `${videoLengthSeconds}`,
            "-segment_format", "mkv",
            "-segment_atclocktime", "1",
            "-strftime", "1",
            `${path.join(this.rawStoragePath, "%Y-%m-%dT%H %M %S%z.mkv")}`
        ];
	}

        this.initTimeoutWatcher();
        this.initFileMover();
        this.initCombinationCron();
        this.startRecording();
        //if(storage.retentionPeriod) this.initOldRecordingsCron();
        this.log(`Camera initialised`);
    }

    // Watch for file changes in the /raw folder. 
    // If there are no changes - the stream has stopped so restart it.
    initTimeoutWatcher() {
        fs.watch(this.rawStoragePath, { encoding: 'buffer' }, (eventType, filename) => {
            if (eventType == 'change') {
                if (this.recordingWatcher) clearInterval(this.recordingWatcher)
                this.recordingWatcher = setInterval(
                    () => {
                        this.log('File change timeout');
                        this.restartRecording()
                    }, timeoutRecordingWatcher);
            }
        })
    }

    // move finished segments to a /yyyy/mm/dd folder
    initFileMover() {
        this.fileMoveInterval = setInterval(
            () => {
                this.moveCompletedFiles();
            },
            1000 * 15
        )
    }

    initCombinationCron() {
        new CronJob('0 3 * * *', async () => {
            try {
                const yesterday = new Date()
                storage.localTimeFormat ? yesterday.setHours(-24, 0, 0, 0) : yesterday.setUTCHours(-24, 0, 0, 0);;
                const dayDir = dayDirectory(this.storagePath, yesterday)
                await videoConcatinator.combineFilesInDirectory(dayDir, true);
            } catch (error) {
                console.log('error combining files', error);
            }
        }, null, true, storage.localTimeFormat ? this.localTimezone : 'UTC');
    }

    initOldRecordingsCron() {
        new CronJob('0 1 * * *', async () => {
            try {
                const deleteOldRecordingsArgs = [
                    storage.rootpath,
                    "-maxdepth", "5",
		    "-name", "*.*",
                    "-mtime +", storage.retentionPeriod,
		    "-delete"
                ]
		//this.deleteOldRecordingsProcess = childProcess.spawn("find", deleteOldRecordingsArgs, {});
                //this.deleteEmptyFoldersProcess = childProcess.spawn("find", [storage.rootpath, "-type", "d", "-empty", "-delete"], {})
                this.deleteOldRecordingsProcess.stdout.on('data', (data) => {
                    this.log('[STDOUT]', data.toString());
                });
		
		const logfile = fs.createWriteStream('delete_old_recordings.log', { flags: 'a'});
                deleteEmptyFoldersProcess.stdout.pipe(logfile);		
    
                this.deleteOldRecordingsProcess.stderr.on('data', (data) => {
                    this.log('[STDERR]', data.toString());
                });
    
                this.deleteOldRecordingsProcess.on('exit', (code) => {
                    this.log(`[EXIT] code ${code}`);
                });
                
                this.deleteOldRecordingsProcess.on('error', (err) => {
                    this.log(`[ERROR]`, err);
                });

            } catch (error) {
                console.log('Error deleting old recordings', error);
                if (this.deleteOldRecordingsProcess) this.deleteOldRecordingsProcess.kill();
                if(this.deleteEmptyFoldersProcess) this.deleteEmptyFoldersProcess.kill();
            }
		}, null, true, storage.localTimeFormat ? this.localTimezone : 'UTC');
    }
    log(message, ...optionalParams) {
        if (storage.localTimeFormat) {
            var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
            var localISOTime = (new Date(Date.now() - tzoffset));
            console.log(`${localISOTime.toISOString()} [${this.name}] ${message}`, ...optionalParams);
        } else {
            console.log(`${new Date().toISOString()} [${this.name}] ${message}`, ...optionalParams);
        }
    }

    restartRecording() {
        this.log('Attempting recording restart...');
        this.killRecording();
        this.startRecording();
    }

    killRecording() {
        if (this.ffmpegProcess) {
            try {
                this.log('Killing ffmpeg process...');
                this.ffmpegProcess.kill();
            } catch (error) {
                this.log('Error killing process', error)
            }
            this.ffmpegProcess = null;
        }
    }

    startRecording() {
        try {
            this.log(`*** Spawing ffmpeg process ***`);
            this.ffmpegProcess = childProcess.spawn("ffmpeg", this.args, {});

            this.ffmpegProcess.stdout.on('data', (data) => {
                this.log('[STDOUT]', data.toString());
            });

            this.ffmpegProcess.stderr.on('data', (data) => {
                this.log('[STDERR]', data.toString());
            });

            this.ffmpegProcess.on('exit', (code) => {
                this.log(`[EXIT] code ${code}`);
            });
            
            this.ffmpegProcess.on('error', (err) => {
                this.log(`[ERROR]`, err);
            });

        } catch (error) {
            this.log('startRecording error', error);
            if (this.ffmpegProcess) this.ffmpegProcess.kill();
        }
    }


    async moveCompletedFiles() {
        const filepaths = await this.getCompletedFiles();
        for (let i = 0; i < filepaths.length; i++) {
            const filepath = filepaths[i];
            await this.moveFileToDated(filepath);
        }
    }

    async getCompletedFiles() {
        let listOfFiles = await fsAsync.readdir(this.rawStoragePath);
        listOfFiles = listOfFiles.sort();
        const filepaths = [];
        while (listOfFiles.length > 1) {
            const filename = listOfFiles.shift();
            if (filename.endsWith('.mkv')) {
                filepaths.push(path.join(this.rawStoragePath, filename));
            }
        }
        return filepaths;
    }

    async moveFileToDated(filepath) {
        const fileDateName = path.basename(filepath, '.mkv');
        let dateString = fileDateName.split(' ').join(':');
        let date = new Date(dateString);
        if (Number.isNaN(date.valueOf())) {
            this.log('Invalid file date', dateString);
            // try just the "yyyy-mm-ddThh:mm:ss" portion
            // Windows systems incorrectly parse the lower case "z" formatter on the ffmpeg date time parser.
            // Instead of (e.g.) "+0100", they have (e.g.) "GMT Summer Time".
            // This doesn't parse as a "new Date( )";
            dateString = dateString.substr(0, 19);
            date = new Date(dateString);
            if (Number.isNaN(date.valueOf())) {
                this.log('Still an invalid file date', dateString);
                // date format still not valid
                return;
            }
        }
        const newDirectory = dayDirectory(this.storagePath, date);
        await fsAsync.mkdir(newDirectory, { recursive: true });
        var tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
        var localISOTime = (new Date(date.getTime() - tzoffset));
        var preferredDate = storage.localTimeFormat ? localISOTime : date;
        const newFilename = `${preferredDate.toISOString().split(':').join(' ').split('.')[0]}.mkv`;
        const newFilepath = path.join(newDirectory, newFilename);
        await fsAsync.rename(filepath, newFilepath);
        this.log(`Moved ${preferredDate.toISOString()}`);
    }
}


function dayDirectory(baseDir = '/', date = new Date()) {
    let year, month, day;
    if (storage.localTimeFormat) {
        year = add_zero(date.getFullYear());
        month = add_zero(date.getMonth() + 1);
        day = add_zero(date.getDate());
    } else {
        year = add_zero(date.getUTCFullYear());
        month = add_zero(date.getUTCMonth() + 1);
        day = add_zero(date.getUTCDate());
    }
    return path.join(baseDir, year, month, day);
}

function add_zero(your_number, length = 2) {
    var num = '' + your_number;
    while (num.length < length) {
        num = '0' + num;
    }
    return num;
}
