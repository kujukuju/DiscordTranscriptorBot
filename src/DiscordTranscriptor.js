const Discord = require('discord.js');
const speech = require('@google-cloud/speech');
const fs = require('fs');
const path = require('path');

process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, '..', 'credentials.json');

const key = String(fs.readFileSync(path.join(__dirname, '..', 'key.txt')));

const rooms = String(fs.readFileSync(path.join(__dirname, '..', 'rooms.txt'))).split('\n');
const roomMap = {};
for (let i = 0; i < rooms.length; i++) {
    rooms[i] = rooms[i].trim().split(' ');
    roomMap[rooms[i][0]] = rooms[i][1];
}

let currentThreadMessageCreating;
let currentThreadMessage;
let currentThreadTime;
let currentThreadParticipants;
let currentThreadCreating;
let currentThread;
let currentVoiceChannel;
let currentTextChannel;

// [{name, time, text}, ...]
const messageQueue = [];

const speechClient = new speech.SpeechClient();
const speechConfig = {
    encoding: 'LINEAR16', // 'OGG_OPUS', // 'WEBM_OPUS',
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

const processMessageQueue = () => {
    // waits until the next message has text to pop them all out
    if (messageQueue.length === 0) {
        return;
    }

    if (!messageQueue[0].text) {
        return;
    }

    if (!currentThreadTime) {
        return;
    }

    const entry = messageQueue.shift();
    currentTextChannel.send('`' + entry.name + ' ' + entry.time + '`: ' + entry.text).then(message => {
        processMessageQueue();
    }).catch(error => {
        console.error('Could not send message. ' , error);
        messageQueue.unshift(entry);

        processMessageQueue();
    });

    // const desiredMessage = currentThreadParticipants.join('\n');
    // if (!currentThreadMessage && !currentThreadMessageCreating) {
    //     currentThreadMessageCreating = true;
    //
    //     currentTextChannel.send(desiredMessage).then(message => {
    //         currentThreadMessage = message;
    //         currentThreadMessageCreating = false;
    //
    //         processMessageQueue();
    //     }).catch(error => {
    //         console.error('Could not create thread message. ', error);
    //         currentThreadMessageCreating = false;
    //
    //         processMessageQueue();
    //     });
    // }
    //
    // if (!currentThreadMessage) {
    //     return;
    // }
    //
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
    //         processMessageQueue();
    //     }).catch(error => {
    //         console.error('Could not create thread. ', error);
    //         currentThreadCreating = false;
    //
    //         processMessageQueue();
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
    //     processMessageQueue();
    // }).catch(error => {
    //     console.error('Could not send thread message. ' , error);
    //     messageQueue.unshift(entry);
    //
    //     processMessageQueue();
    // });

};

const joinVoiceChannel = (guild, channelID) => {
    if (currentVoiceChannel) {
        return;
    }

    const requestedChannels = getRecordingChannelPair(guild, channelID);
    if (!requestedChannels) {
        return;
    }

    const [voiceChannel, textChannel] = requestedChannels;
    // const bitrate = voiceChannel.bitrate;
    voiceChannel.join().then(connection => {
        connection.on('speaking', (user, speaking) => {
            if (speaking.bitfield) {
                const data = [];

                const startTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
                const entry = {
                    name: user.username,
                    time: formatTime(startTime),
                    text: null,
                };
                messageQueue.push(entry);

                if (!currentThreadParticipants) {
                    currentThreadParticipants = [];
                }

                if (!currentThreadParticipants.includes(user.username)) {
                    currentThreadParticipants.push(user.username);
                }

                const stream = connection.receiver.createStream(user.id, {mode: 'pcm'});
                stream.on('data', chunk => {
                    const array = new Uint8Array(chunk);
                    data.push(...array);
                });
                stream.on('end', () => {
                    const bytes = new Uint8Array(data);

                    // TODO long recognize? maybe based on time duration?
                    speechClient.recognize({
                        config: speechConfig,
                        audio: {
                            content: bytes,
                        },
                    }).then(response => {
                        const transcript = response[0]?.results[0]?.alternatives[0]?.transcript;
                        if (transcript) {
                            entry.text = transcript;

                            processMessageQueue();
                        } else {
                            const index = messageQueue.indexOf(entry);
                            if (index === -1) {
                                console.error('Could not find message queue entry to remove.');
                            } else {
                                messageQueue.splice(index, 1);
                            }
                        }
                    }).catch(error => {
                        console.error('Could not process speech. ', error);
                    });
                });
            }
        });
    }).catch(error => {
        console.error('Unable to join voice channel. ', error);
    });

    guild.me.edit({mute: true}).then(() => {}).catch(error => {
        console.error('Could not mute self. ', error);
    });

    currentThreadTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    currentVoiceChannel = voiceChannel;
    currentTextChannel = textChannel;
};

const leaveVoiceChannel = (guild, channelID) => {
    if (!currentVoiceChannel) {
        return;
    }

    const channel = guild.channels.resolve(channelID);
    if (currentVoiceChannel.id !== channel.id) {
        return;
    }

    const memberCount = channel.members.size;
    if (memberCount <= 1) {
        channel.leave();
        currentThreadMessage = null;
        currentThreadTime = null;
        currentThreadParticipants = null;
        currentThreadCreating = null;
        currentVoiceChannel = null;
        currentTextChannel = null;
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

const formatTime = (date) => {
    const hours = ((date.getHours()) % 12) || 12;
    const pm = date.getHours() + 1 >= 12;
    const minutes = date.getMinutes();

    return hours + ':' + minutes + ' ' + (pm ? 'PM' : 'AM');
};

client.login(key);