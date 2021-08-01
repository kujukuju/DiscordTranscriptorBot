const Discord = require('discord.js');
const speech = require('@google-cloud/speech');
const fs = require('fs');
const path = require('path');

process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, '..', 'credentials.json');

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDuration = 50 * 1000;

const key = String(fs.readFileSync(path.join(__dirname, '..', 'key.txt')));

const rooms = String(fs.readFileSync(path.join(__dirname, '..', 'rooms.txt'))).split('\n');
const roomMap = {};
for (let i = 0; i < rooms.length; i++) {
    rooms[i] = rooms[i].trim().split(' ');
    roomMap[rooms[i][0]] = rooms[i][1];
}

let currentData;

const speechClient = new speech.SpeechClient();
const speechConfig = {
    encoding: 'LINEAR16', // LINEAR16, OGG_OPUS, WEBM_OPUS
    sampleRateHertz: 48000, // ???
    audioChannelCount: 2,
    languageCode: 'en-US',
};

// const intents = new Discord.Intents(Discord.Intents.FLAGS.GUILD_MESSAGES | Discord.Intents.FLAGS.GUILD_VOICE_STATES | Discord.Intents.FLAGS.GUILDS);
const client = new Discord.Client();

client.on('ready', () => {
    console.log('Logged in as ' + client.user.tag + '.');
    client.guilds.cache.every(guild => {
        const voiceChannel = guild.me.voice.channel;
        if (voiceChannel) {
            if (!voiceChannel.members || voiceChannel.members.size <= 1) {
                voiceChannel.join().then(() => {
                    voiceChannel.leave();
                }).catch(error => {
                    console.error('Could not leave empty voice channel after crashing. ', error);
                });
            } else {
                joinVoiceChannel(guild, voiceChannel.id);
            }
        }
    });
});

client.on('voiceStateUpdate', (oldState, newState) => {
    if (newState.channelID) {
        joinVoiceChannel(newState.guild, newState.channelID);
    } else if (oldState.channelID) {
        leaveVoiceChannel(oldState.guild, oldState.channelID);
    }
});

const processMessageQueue = (data) => {
    // waits until the next message has text to pop them all out
    if (data.messageQueue.length === 0) {
        return;
    }

    if (!data.messageQueue[0].text) {
        return;
    }

    if (!data.currentThreadTime) {
        return;
    }

    if (!data.currentThreadMessage && !data.currentThreadMessageCreating) {
        data.currentThreadMessageCreating = true;

        data.currentTextChannel.send(getDesiredThreadMessage(data)).then(message => {
            data.currentThreadMessage = message;
            data.currentThreadMessageCreating = false;

            processMessageQueue(data);
        }).catch(error => {
            console.error('Could not create thread message. ', error);
            data.currentThreadMessageCreating = false;

            processMessageQueue(data);
        });
    }

    if (!data.currentThreadMessage) {
        return;
    }

    const entry = data.messageQueue.shift();
    data.currentTextChannel.send('`' + entry.name + ' ' + entry.time + '`: ' + entry.text).then(message => {
        processMessageQueue(data);
    }).catch(error => {
        console.error('Could not send message. ' , error);
        data.messageQueue.unshift(entry);

        processMessageQueue(data);
    });

    // if (!currentThread && !currentThreadCreating) {
    //     currentThreadCreating = true;
    //
    //     const hours = (currentThreadTime.getHours() + 1) % 12;
    //     const pm = currentThreadTime.getHours() + 1 >= 12;
    //     const minutes = currentThreadTime.getMinutes();
    //     const name = currentVoiceChannel.name + ' ' + hours + ':' + minutes + ' ' + (pm ? 'PM' : 'AM');
    //     currentThreadMessage.startThread(name, 1440).then(thread => {
    //         currentThread = thread;
    //         currentThreadCreating = false;
    //
    //         processMessageQueue(data);
    //     }).catch(error => {
    //         console.error('Could not create thread. ', error);
    //         currentThreadCreating = false;
    //
    //         processMessageQueue(data);
    //     });
    // }
    //
    // if (!currentThread) {
    //     return;
    // }
    //
    // const message = currentThreadMessage.content;
    // if (message !== desiredMessage) {
    //     currentThreadMessage.edit(desiredMessage);
    // }
    //
    // const entry = messageQueue.shift();
    // currentThread.send(entry.name + ' ' + entry.time + ': ' + entry.text).then(message => {
    //     processMessageQueue(data);
    // }).catch(error => {
    //     console.error('Could not send thread message. ' , error);
    //     messageQueue.unshift(entry);
    //
    //     processMessageQueue(data);
    // });

};

const joinVoiceChannel = (guild, channelID) => {
    if (currentData && currentData.currentVoiceChannel) {
        return;
    }

    const requestedChannels = getRecordingChannelPair(guild, channelID);
    if (!requestedChannels) {
        return;
    }

    const [voiceChannel, textChannel] = requestedChannels;

    const data = createNewData();
    currentData = data;
    data.currentThreadTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    data.currentVoiceChannel = voiceChannel;
    data.currentTextChannel = textChannel;

    // const bitrate = voiceChannel.bitrate;
    voiceChannel.join().then(connection => {
        connection.on('speaking', (user, speaking) => {
            if (speaking.bitfield) {
                const bytes = [];

                const startMilliseconds = Date.now();
                const startTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
                const entry = {
                    name: user.username,
                    time: formatTimeShort(startTime),
                    text: null,
                };
                data.messageQueue.push(entry);

                if (!data.currentThreadParticipants) {
                    data.currentThreadParticipants = [];
                }

                if (!data.currentThreadParticipants.includes(user.username)) {
                    data.currentThreadParticipants.push(user.username);

                    // TODO if this fails due to rate limits it won't try again
                    if (data.currentThreadMessage) {
                        data.currentThreadMessage.edit(getDesiredThreadMessage(data));
                    }
                }

                const processTranscript = (transcript) => {
                    if (transcript) {
                        entry.text = transcript;

                        processMessageQueue(data);
                    } else {
                        const index = data.messageQueue.indexOf(entry);
                        if (index === -1) {
                            console.error('Could not find message queue entry to remove.');
                        } else {
                            data.messageQueue.splice(index, 1);
                        }
                    }
                };

                const stream = connection.receiver.createStream(user.id, {mode: 'pcm'}); // opus, pcm
                stream.on('data', chunk => {
                    const array = new Uint8Array(chunk);
                    bytes.push(...array);
                });
                stream.on('end', () => {
                    const byteArray = new Uint8Array(bytes);

                    if (Date.now() - startMilliseconds > longDuration) {
                        speechClient.longRunningRecognize({
                            config: speechConfig,
                            audio: {
                                content: byteArray,
                            }
                        }).then(operations => {
                            const operation = operations[0];
                            operation.promise().then(response => {
                                const transcript = response[0]?.results[0]?.alternatives[0]?.transcript;
                                processTranscript(transcript);
                            }).catch(error => {
                                console.error('Could not resolve long running promise. ', error);
                            });
                        }).catch(error => {
                            console.error('Could not run longRunningRecognize. ', error);
                        });
                    } else {
                        speechClient.recognize({
                            config: speechConfig,
                            audio: {
                                content: byteArray,
                            },
                        }).then(response => {
                            const transcript = response[0]?.results[0]?.alternatives[0]?.transcript;
                            processTranscript(transcript);
                        }).catch(error => {
                            console.error('Could not process speech. ', error);
                        });
                    }
                });
            }
        });
    }).catch(error => {
        // TODO should this be retried?
        console.error('Unable to join voice channel. ', error);
    });

    guild.me.edit({mute: true}).then(() => {}).catch(error => {
        console.error('Could not mute self. ', error);
    });
};

const leaveVoiceChannel = (guild, channelID) => {
    if (!currentData || !currentData.currentVoiceChannel) {
        return;
    }

    const channel = guild.channels.resolve(channelID);
    if (currentData.currentVoiceChannel.id !== channel.id) {
        return;
    }

    const memberCount = channel.members.size;
    if (memberCount <= 1) {
        channel.leave();
        currentData = null;
    }
};

const getRecordingChannelPair = (guild, recordingChannelID) => {
    const channel = guild.channels.resolve(recordingChannelID);
    if (!channel) {
        return null;
    }

    const name = channel.name;
    if (!roomMap[name]) {
        return null;
    }

    const transcribeChannelName = roomMap[name];
    const transcribeChannel = guild.channels.cache.find(potential => potential.name === transcribeChannelName);
    if (!transcribeChannel) {
        return null;
    }

    return [channel, transcribeChannel];
};

const getDesiredThreadMessage = (data) => {
    return data.currentVoiceChannel.name + ' - ' + formatTime(data.currentThreadTime) + '\n' + data.currentThreadParticipants.join('\n');
};

const formatTime = (date) => {
    const month = months[date.getMonth()];
    const weekDay = days[date.getDay()];
    const monthDay = date.getDate();

    return weekDay + ', ' + month + ' ' + monthDay + ', ' + formatTimeShort(date);
};

const formatTimeShort = (date) => {
    const hours = ((date.getHours()) % 12) || 12;
    const pm = date.getHours() + 1 >= 12;
    let minutes = String(date.getMinutes());
    let seconds = String(date.getSeconds());

    if (minutes.length < 2) {
        minutes = '0' + minutes;
    }
    if (seconds.length < 2) {
        seconds = '0' + seconds;
    }

    return hours + ':' + minutes + ':' + seconds + ' ' + (pm ? 'PM' : 'AM');
};

const createNewData = () => {
    return {
        messageQueue: [],
        currentThreadMessageCreating: null,
        currentThreadMessage: null,
        currentThreadTime: null,
        currentThreadParticipants: null,
        currentThreadCreating: null,
        currentThread: null,
        currentVoiceChannel: null,
        currentTextChannel: null,
    };
};

client.login(key);