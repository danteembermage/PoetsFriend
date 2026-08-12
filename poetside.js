// --- 1. DOM Elements ---
const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
const ideContainer = document.getElementById('ide-container');
const editor = document.getElementById('editor');

const targetWordSpan = document.getElementById('target-word');
const rhymeList = document.getElementById('rhyme-list');
const familyRhymeList = document.getElementById('family-rhyme-list');
const consonanceList = document.getElementById('consonance-list');

// --- 2. IDE State & Indexes ---
const dictionary = {};
const frequencySet = new Set();

// O(1) Lookup Indexes
const rhymeIndex = {};
const familyRhymeIndex = {}; 
const exactPhonemeIndex = {}; // Used for generating multi-word phrases
const consonanceIndex = {}; 

const LINES_PER_FRAME = 3000;
let currentTargetWord = "";

// Phonetic families for assonance/family rhymes
const phoneticFamilies = {
    'P': 'PLOS', 'T': 'PLOS', 'K': 'PLOS', 'B': 'PLOS', 'D': 'PLOS', 'G': 'PLOS',
    'F': 'FRIC', 'V': 'FRIC', 'TH': 'FRIC', 'DH': 'FRIC', 'S': 'FRIC', 'Z': 'FRIC', 'SH': 'FRIC', 'ZH': 'FRIC',
    'CH': 'AFF', 'JH': 'AFF',
    'M': 'NAS', 'N': 'NAS', 'NG': 'NAS',
    'L': 'LIQ', 'R': 'LIQ'
};

// --- 3. Initialization & Loading ---
window.onload = () => {
    loadGameData();
    editor.addEventListener('keyup', debounce(handleInput, 300));
    editor.addEventListener('click', handleInput); 
};

async function loadGameData() {
    try {
        try {
            const freqResponse = await fetch('frequency.txt');
            if (freqResponse.ok) {
                const freqText = await freqResponse.text();
                freqText.split('\n').forEach(line => {
                    const word = line.trim().toUpperCase();
                    if (word) frequencySet.add(word);
                });
            }
        } catch (e) {
            console.warn("Could not load frequency.txt, using unweighted results.");
        }

        loadingText.textContent = "Processing phonemes...";
        const dictResponse = await fetch('dictionary.txt');
        
        if (!dictResponse.ok) {
            throw new Error("dictionary.txt not found!");
        }
        
        const dictText = await dictResponse.text();
        const lines = dictText.split('\n');
        const totalLines = lines.length;

        function processDictionaryChunk(index) {
            let endIndex = Math.min(index + LINES_PER_FRAME, totalLines);
            
            for (let i = index; i < endIndex; i++) {
                let line = lines[i];
                if (line && !line.startsWith(';;;')) {
                    const parts = line.split('  '); 
                    if (parts.length === 2) {
                        const word = parts[0].replace(/\(\d+\)/g, '').toUpperCase();
                        const phonemesStr = parts[1].trim();
                        const phonemes = phonemesStr.split(' ').filter(p => p);
                        
                        if (!dictionary[word]) {
                            dictionary[word] = phonemes;
                            
                            // A. Exact Phoneme Index (For multi-word phrases)
                            const exactKey = phonemes.join(' ');
                            if (!exactPhonemeIndex[exactKey]) exactPhonemeIndex[exactKey] = new Set();
                            exactPhonemeIndex[exactKey].add(word);
                        }

                        // B. Rhymes & Family Rhymes
                        let stressIdx = phonemes.findIndex(p => /[12]/.test(p));
                        if (stressIdx !== -1) {
                            const rhymeEndingArray = phonemes.slice(stressIdx);
                            
                            // True Rhyme
                            const rhymeKey = rhymeEndingArray.join(' ');
                            if (!rhymeIndex[rhymeKey]) rhymeIndex[rhymeKey] = new Set();
                            rhymeIndex[rhymeKey].add(word);

                            // Family Rhyme (Convert trailing consonants to families)
                            const familyKey = getFamilyKey(rhymeEndingArray);
                            if (!familyRhymeIndex[familyKey]) familyRhymeIndex[familyKey] = new Set();
                            familyRhymeIndex[familyKey].add(word);
                        }

                        // C. Consonance (Match all consonants, strip vowels)
                        const cons = phonemes.filter(p => !/[012]/.test(p)).join(' ');
                        if (cons.length > 0) {
                            if (!consonanceIndex[cons]) consonanceIndex[cons] = new Set();
                            consonanceIndex[cons].add(word);
                        }
                    }
                }
            }

            loadingBar.style.width = `${(endIndex / totalLines) * 100}%`;

            if (endIndex < totalLines) {
                setTimeout(() => processDictionaryChunk(endIndex), 0);
            } else {
                finishLoading();
            }
        }
        
        processDictionaryChunk(0);

    } catch (err) {
        loadingText.textContent = `Error: ${err.message}`;
        loadingText.style.color = "red";
    }
}

function finishLoading() {
    console.log(`IDE Loaded. Processed ${Object.keys(dictionary).length} words.`);
    loadingScreen.classList.add('hidden');
    ideContainer.classList.remove('hidden');
    editor.focus();
}

function getFamilyKey(phonemeSequence) {
    return phonemeSequence.map(p => {
        if (/[012]/.test(p)) return p; // Keep vowels intact
        let pClean = p.replace(/[012]/g, ''); 
        return phoneticFamilies[pClean] || p; // Map to family or keep original
    }).join(' ');
}

// --- 4. Core Editor Logic ---

function handleInput() {
    const cursorPosition = editor.selectionStart;
    const textUpToCursor = editor.value.slice(0, cursorPosition);
    
    const words = textUpToCursor.trim().toUpperCase().split(/[^A-Z']+/);
    const targetWord = words[words.length - 1];

    if (!targetWord || targetWord === currentTargetWord) return;

    if (dictionary[targetWord]) {
        currentTargetWord = targetWord;
        analyzeWord(targetWord);
    } else {
        targetWordSpan.textContent = targetWord.toLowerCase() + " (not found)";
    }
}

function analyzeWord(word) {
    targetWordSpan.textContent = word.toLowerCase();
    const phonemes = dictionary[word];
    
    // 1. Find True Rhymes
    let stressIdx = phonemes.findIndex(p => /[12]/.test(p));
    let rhymes = [];
    let familyRhymes = [];
    let multiWordRhymes = [];

    if (stressIdx !== -1) {
        const rhymeEndingArray = phonemes.slice(stressIdx);
        const rhymeKey = rhymeEndingArray.join(' ');
        rhymes = Array.from(rhymeIndex[rhymeKey] || []).filter(w => w !== word);

        // 2. Find Family Rhymes (Filter out true rhymes)
        const familyKey = getFamilyKey(rhymeEndingArray);
        familyRhymes = Array.from(familyRhymeIndex[familyKey] || []).filter(w => w !== word && !rhymes.includes(w));

        // 3. Generate Multi-Word Phrases
        multiWordRhymes = findMultiWordRhymes(rhymeEndingArray);
    }

    // 4. Find Consonance (Near Rhymes)
    let nearRhymes = [];
    const cons = phonemes.filter(p => !/[012]/.test(p)).join(' ');
    if (cons.length > 0) {
        nearRhymes = Array.from(consonanceIndex[cons] || []).filter(w => w !== word && !rhymes.includes(w));
    }

    // Combine Multi-words and Family Rhymes
    let combinedFamily = [...multiWordRhymes, ...sortAndLimit(familyRhymes, 30)];

    // Render to UI
    renderSuggestions(rhymeList, sortAndLimit(rhymes));
    renderSuggestions(familyRhymeList, combinedFamily);
    renderSuggestions(consonanceList, sortAndLimit(nearRhymes));
}

// --- 5. Phrase Generation Engine ---

function findMultiWordRhymes(rhymeEndingArray) {
    let multiWords = [];
    if (rhymeEndingArray.length < 2) return [];

    // Iterate through possible ways to split the rhyme sequence into two words
    for (let i = 1; i < rhymeEndingArray.length; i++) {
        let part1Key = rhymeEndingArray.slice(0, i).join(' '); 
        let part2Key = rhymeEndingArray.slice(i).join(' ');    

        // Find words that END with part 1
        let words1 = rhymeIndex[part1Key]; 
        
        // Find words that EXACTLY MATCH part 2 (allowing for unstressed vowel leniency)
        let part2Variations = getVowelVariations(part2Key);
        let words2Set = new Set();
        part2Variations.forEach(v => {
            if (exactPhonemeIndex[v]) {
                exactPhonemeIndex[v].forEach(w => words2Set.add(w));
            }
        });

        if (words1 && words2Set.size > 0) {
            // Take highly common words to prevent combinatorial explosion
            let w1List = sortAndLimit(Array.from(words1), 6);
            let w2List = sortAndLimit(Array.from(words2Set), 3);

            for (let w1 of w1List) {
                for (let w2 of w2List) {
                    multiWords.push(`${w1} ${w2}`);
                }
            }
        }
    }
    return multiWords;
}

// Allows small unstressed words like "IT" or "A" to match sligthly different schwa variations
function getVowelVariations(phonemeStr) {
    let variations = new Set([phonemeStr]);
    variations.add(phonemeStr.replace(/AH0/g, 'IH0'));
    variations.add(phonemeStr.replace(/AH0/g, 'EH0'));
    variations.add(phonemeStr.replace(/IH0/g, 'AH0'));
    variations.add(phonemeStr.replace(/IH0/g, 'EH0'));
    variations.add(phonemeStr.replace(/IH1/g, 'IH0')); 
    variations.add(phonemeStr.replace(/AH1/g, 'AH0')); 
    return Array.from(variations);
}

// --- 6. UI Helpers ---

function sortAndLimit(wordArray, limit = 40) {
    return wordArray.sort((a, b) => {
        const aFreq = frequencySet.has(a) ? 1 : 0;
        const bFreq = frequencySet.has(b) ? 1 : 0;
        if (bFreq === aFreq) return a.length - b.length; // Favor shorter words if frequency matches
        return bFreq - aFreq; 
    }).slice(0, limit);
}

function renderSuggestions(container, words) {
    container.innerHTML = ""; 
    
    if (words.length === 0) {
        container.innerHTML = `<span style="color: #666; font-style: italic;">No matches found.</span>`;
        return;
    }

    words.forEach(word => {
        const span = document.createElement('span');
        span.className = 'word-badge';
        
        // Add special styling if it's a multi-word phrase
        if (word.includes(' ')) {
            span.classList.add('phrase-badge');
        }

        span.textContent = word.toLowerCase();
        span.onclick = () => insertWord(word.toLowerCase());
        container.appendChild(span);
    });
}

function insertWord(word) {
    const cursorPos = editor.selectionStart;
    const text = editor.value;
    
    const newText = text.slice(0, cursorPos) + word + " " + text.slice(cursorPos);
    editor.value = newText;
    
    const newCursorPos = cursorPos + word.length + 1;
    editor.setSelectionRange(newCursorPos, newCursorPos);
    editor.focus();
    
    handleInput();
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
