// Everything the app itself says around a call, in one place.
export const agentMessages = {
  connecting: 'Waking the agent.',
  micExplain:
    'To talk with the agent, the app needs your microphone. It listens only while the agent is awake. Your iPhone will now ask for permission. Choose Allow.',
  micDenied:
    "The agent can't hear you because the microphone is turned off for this app. To turn it on, open the Settings app, scroll to Juno, open it, and turn on Microphone. Back to scrolling.",
  couldNotConnect: "I couldn't connect. Check your internet and try again.",
  notConfigured: "The voice agent isn't set up in this version of the app. Back to scrolling.",
  asleep: 'Agent is asleep. Back to scrolling.',
  silence: 'The agent went to sleep after 30 seconds of quiet. Back to scrolling.',
  maxDuration: 'The conversation reached its 10 minute limit, so the agent went to sleep. Back to scrolling.',
  dropped: 'The agent disconnected. Back to scrolling.',
  signIn: 'Opening the sign-in screen.',
  notSent: 'Your post was not sent. ',
  undone: 'Stopped. Nothing was sent.',
  undoWhileSending: "One moment, it's going out right now.",
  stoppedBeforeSend: 'Stopped it before it went out.',
  deletedAfterSend: 'It had gone out, so I deleted it.',
  removedRepostAfterSend: 'It had gone out, so I removed the repost.',
  deletedBeforeUndo: "It was already deleted. A deleted post can't be brought back.",
  failedBeforeUndo: "It didn't go out, so there was nothing to remove.",
  postStuck: "It went out, and I couldn't remove it. Say delete my last post to remove it.",
  repostStuck: "It went out, and I couldn't remove the repost. Say undo to try again.",
  held: 'I stopped it, nothing was sent.',
  descriptionOnItsWay: 'A fuller description of the picture is still on its way.',
};
