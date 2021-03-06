const logger = require('@greencoast/logger');
const { createAudioResource } = require('@discordjs/voice');
const GoogleProvider = require('./providers/GoogleProvider');
const AeiouProvider = require('./providers/AeiouProvider');
const Queue = require('../Queue');
const VoiceManager = require('../VoiceManager');
const { InvalidProviderError } = require('../../errors');

class TTSPlayer {
  constructor(client, guild, disconnectScheduler) {
    this.client = client;
    this.guild = guild;
    this.disconnectScheduler = disconnectScheduler;

    this.queue = new Queue();
    this.speaking = false;
    this.voice = new VoiceManager(guild);

    this.initializePlayer();
    this.initializeScheduler();

    this.googleProvider = new GoogleProvider();
    this.aeiouProvider = new AeiouProvider();
  }

  initializePlayer() {
    this.voice.player.on('error', (error) => {
      logger.error(error);
      this.speaking = false;
      this.play();
    });

    this.voice.player.on('idle', () => {
      if (this.speaking) {
        this.speaking = false;
        this.play();
      }
    });
  }

  initializeScheduler() {
    this.disconnectScheduler.set(() => {
      const channel = this.stop();
      logger.warn(`Left ${channel.name} from ${this.guild.name} due to inactivity.`);
    });
  }

  getProvider(providerName) {
    switch (providerName) {
      case GoogleProvider.NAME:
        return this.googleProvider;

      case AeiouProvider.NAME:
        return this.aeiouProvider;

      default:
        throw new InvalidProviderError(`${providerName} is not a valid provider!`);
    }
  }

  async say(sentence, providerName, extras = {}) {
    const provider = this.getProvider(providerName);
    const payload = await provider.createPayload(sentence, extras);

    if (Array.isArray(payload)) {
      payload.forEach((p) => this.queue.enqueue(p));
    } else {
      this.queue.enqueue(payload);
    }

    this.startDisconnectScheduler();

    if (!this.speaking) {
      this.play();
    }
  }

  async play() {
    if (this.queue.isEmpty()) {
      return;
    }

    const payload = this.queue.dequeue();
    const provider = this.getProvider(payload.providerName);

    logger.info(provider.getPlayLogMessage(payload, this.guild));

    this.speaking = true;
    this.voice.play(createAudioResource(payload.resource, {
      metadata: {
        title: payload.sentence
      }
    }));
  }

  stop() {
    const { channel } = this.guild.me.voice;

    this.stopDisconnectScheduler();

    this.queue.clear();
    this.speaking = false;
    this.voice.disconnect();
    this.voice.player.stop(true);

    return channel || { name: 'null' };
  }

  startDisconnectScheduler() {
    if (!this.disconnectScheduler) {
      return;
    }

    if (this.disconnectScheduler.isAlive()) {
      this.disconnectScheduler.refresh();
    } else {
      this.disconnectScheduler.start(this);
    }
  }

  stopDisconnectScheduler() {
    if (!this.disconnectScheduler) {
      return;
    }

    if (this.disconnectScheduler.isAlive()) {
      this.disconnectScheduler.stop();
    }
  }
}

TTSPlayer.SUPPORTED_PROVIDERS = [GoogleProvider, AeiouProvider];
TTSPlayer.DEFAULT_PROVIDER = GoogleProvider;

TTSPlayer.PROVIDER_FRIENDLY_NAMES = TTSPlayer.SUPPORTED_PROVIDERS.reduce((obj, Provider) => {
  return {
    ...obj,
    [Provider.NAME]: Provider.FRIENDLY_NAME
  };
}, {});
TTSPlayer.PROVIDER_DEFAULTS = TTSPlayer.SUPPORTED_PROVIDERS.reduce((obj, Provider) => {
  return {
    ...obj,
    [Provider.NAME]: Provider.EXTRA_DEFAULTS
  };
}, {});
TTSPlayer.DEFAULT_SETTINGS = {
  provider: TTSPlayer.DEFAULT_PROVIDER.NAME,
  ...TTSPlayer.PROVIDER_DEFAULTS
};

module.exports = TTSPlayer;
