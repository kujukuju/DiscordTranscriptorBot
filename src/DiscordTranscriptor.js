const Discord = require('discord.js');
const fs = require('fs');
const path = require('path');

const key = String(fs.readFileSync(path.join(__dirname, '..', 'key.txt')));

const rooms = String(fs.readFileSync(path.join(__dirname, '..', 'rooms.txt'))).split('\n');
const roomMap = {};
for (let i = 0; i < rooms.length; i++) {
    rooms[i] = rooms[i].trim().split(' ');
    roomMap[rooms[i][0]] = rooms[i][1];
}

let currentVoiceChannel;
let currentTextChannel;

const client = new Discord.Client();
client.on('ready', () => {
    console.log('Logged in as ' + client.user.tag + '.');
    client.guilds.cache.every(guild => {
        const voiceChannel = guild.me.voice.channel;
        if (voiceChannel) {
            console.log(voiceChannel.members.size);
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

const joinVoiceChannel = (guild, channelID) => {
    if (currentVoiceChannel) {
        return;
    }

    const requestedChannels = getRecordingChannelPair(guild, channelID);
    if (!requestedChannels) {
        return;
    }

    const [voiceChannel, textChannel] = requestedChannels;
    const bitrate = voiceChannel.bitrate;
    voiceChannel.join().then(connection => {
        connection.on('speaking', (user, speaking) => {
            if (speaking.bitfield) {
                const stream = connection.receiver.createStream(user.id);
                stream.on('data', chunk => {
                    console.log('speaking data ', chunk);
                });
                stream.on('end', () => {
                    console.log('speaking stream ended');
                });
            }
        });
    }).catch(error => {
        console.error('Unable to join voice channel. ', error);
    });

    guild.me.edit({mute: true}).then(() => {}).catch(error => {
        console.error('Could not mute self. ', error);
    });

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

client.login(key);