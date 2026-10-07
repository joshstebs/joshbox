export function suggestedPrompts(prompt, kind) {
    const p = prompt.toLowerCase();
    const choices = [];
    if (kind === 'video') {
        if (!/camera|pan|zoom|push|tracking|dolly/.test(p))
            choices.push('The camera slowly pushes in.');
        if (/walk|run|dance|turn|person|character/.test(p) && !/natural|fluid|smooth/.test(p))
            choices.push('Keep the movement natural and fluid.');
        if (/forest|water|ocean|beach|wind|tree/.test(p) && !/sound|audio|ambient/.test(p))
            choices.push('Add soft ambient sounds that match the scene.');
        if (!/light|sun|golden|shadow/.test(p))
            choices.push('Use soft, cinematic lighting.');
        if (!/composition|consistent|preserve/.test(p))
            choices.push('Preserve the subject and composition of the starting image.');
        if (!/sound|audio/.test(p))
            choices.push('Add subtle natural sound.');
    }
    else {
        if (!/light|sun|golden|shadow/.test(p))
            choices.push('Soft golden-hour lighting.');
        if (/portrait|person|character|face/.test(p) && !/expression/.test(p))
            choices.push('A relaxed, natural expression.');
        if (!/background|setting|scene/.test(p))
            choices.push('A simple background with gentle depth of field.');
        if (!/film|cinematic|editorial/.test(p))
            choices.push('An editorial photography style with subtle film grain.');
    }
    return choices.filter(c => !p.includes(c.toLowerCase().replace(/\.$/, ''))).slice(0, 4);
}
export function appendSuggestion(prompt, suggestion) {
    const base = prompt.trim();
    return (base ? base + (/[.!?]$/.test(base) ? ' ' : '. ') : '') + suggestion;
}
export function boostedPrompt(prompt, kind) {
    if (!prompt.trim())
        return '';
    return suggestedPrompts(prompt, kind).slice(0, 2).reduce(appendSuggestion, prompt.trim()).slice(0, 3000);
}
