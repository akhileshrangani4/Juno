import { heardAs, qualityCue, subjectCue, type DecisionAnswer } from '../checks';

const answer = (overrides: Partial<DecisionAnswer>): DecisionAnswer => ({ inView: null, cutOff: null, tooDark: null, tooBlurry: null, ...overrides });

describe('quick checks as cues', () => {
  it('says the subject back in the second person', () => {
    expect(heardAs('my dog')).toBe('your dog');
    expect(heardAs('the whole sign?')).toBe('the whole sign');
    expect(heardAs('me and my sister')).toBe('you and your sister');
  });

  it('says when the subject is not in view yet, and nothing while unsure', () => {
    expect(subjectCue(answer({ inView: 0.1 }), 'my dog')).toBe("I don't see your dog yet. Move the phone slowly.");
    expect(subjectCue(answer({ inView: 0.45 }), 'my dog')).toBeNull();
    expect(subjectCue(answer({ inView: null }), 'my dog')).toBeNull();
  });

  it('names the cut-off edge and the way to move', () => {
    expect(subjectCue(answer({ inView: 0.9, cutOff: 'right' }), 'the sign')).toBe('Part of the sign is cut off on the right. Move right.');
    expect(subjectCue(answer({ inView: 0.9, cutOff: 'left' }), 'the sign')).toBe('Part of the sign is cut off on the left. Move left.');
    expect(subjectCue(answer({ inView: 0.9, cutOff: 'top' }), 'the sign')).toBe('Part of the sign is cut off at the top. Tilt up.');
    expect(subjectCue(answer({ inView: 0.9, cutOff: 'bottom' }), 'the sign')).toBe('Part of the sign is cut off at the bottom. Tilt down.');
    expect(subjectCue(answer({ inView: 0.9, cutOff: 'several' }), 'the whole sign')).toBe("The whole sign doesn't fit. Move farther away.");
  });

  it('confirms when the subject is in the picture', () => {
    expect(subjectCue(answer({ inView: 0.9, cutOff: 'none' }), 'my dog')).toBe('Your dog is in the picture.');
  });

  it('warns when the picture is too dark or blurred to post', () => {
    expect(qualityCue(answer({ tooDark: 0.9, tooBlurry: 0.1 }))).toBe("It's too dark to post. Find more light.");
    expect(qualityCue(answer({ tooDark: 0.1, tooBlurry: 0.8 }))).toBe("It's too blurred to post. Hold the phone steadier.");
    expect(qualityCue(answer({ tooDark: 0.9, tooBlurry: 0.8 }))).toBe("It's too dark and blurred to post.");
    expect(qualityCue(answer({ tooDark: 0.2, tooBlurry: null }))).toBeNull();
  });
});
