Create `key.txt` in the root folder of the project.
Put your secret key in there.

Create `rooms.txt` in the root folder of the project.
Put the name of the voice channel to transcribe from, then a space, then the name of the text channel to transcribe into.
You can have multiple lines.
For example:
```text
Voice text
General main
```

Get your credentials file from https://cloud.google.com/speech-to-text/ and place it in the root folder as `credentials.json`.

Navigate to https://discord.com/api/oauth2/authorize?client_id=870594659691417642&permissions=103086557184&scope=bot and add your bot to your server.