// --- 1. DOM Elements ---
const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
const ideContainer = document.getElementById('ide-container');
const editor = document.getElementById('editor');

const targetWordSpan = document.getElementById('target-word');
const rhymeList = document.getElementById('rhyme-list');
const alliterationList = document.getElementById('alliteration-list');
const consonanceList = document.getElementById('consonance-list');

// --- 2. IDE State & Indexes ---
const dictionary = {};
const frequencySet = new Set();

// O(1) Lookup Indexes
const rhymeIndex = {};
const alliterationIndex = {};
const consonanceIndex = {}; 

const LINES_PER_FRAME = 3000;
let currentTargetWord = "";

// --- 3. Initialization & Loading ---
window.onload = () => {
    loadGameData();
    
    // Listen for typing in the editor (debounced for performance)
    editor.addEventListener('keyup', debounce(handleInput, 300));
    editor.addEventListener('click', handleInput); // Catch cursor moves
};

async function loadGameData() {
    try {
        // 1. Load frequency list (optional, but helps sort common words first)
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

        // 2. Load dictionary (CMU format)
        loadingText.textContent = "Processing phonemes...";
        const dictResponse = await fetch('dictionary.txt');
        
        if (!dictResponse.ok) {
            throw new Error("dictionary.txt not found! Please ensure it is in the same folder.");
        }
        
        const dictText = await dictResponse.text();
        const lines = dictText.split('\n');
        const totalLines = lines.length;

        function processDictionaryChunk(index) {
            let endIndex = Math.min(index + LINES_PER_FRAME, totalLines);
            
            for (let i = index; i < endIndex; i++) {
                let line = lines[i];
                if (line && !line.startsWith(';;;')) {
                    const parts = line.split('  '); // CMU dict uses double spaces
                    if (parts.length === 2) {
                        // Strip trailing (1), (2) from alternate pronunciations
                        const word = parts[0].replace(/\(\d+\)/g, '').toUpperCase();
                        const phonemesStr = parts[1].trim();
                        const phonemes = phonemesStr.split(' ').filter(p => p);
                        
                        // Keep only the first/primary pronunciation for mapping
                        if (!dictionary[word]) {
                            dictionary[word] = phonemes;
                        }

                        // --- Build O(1) Lookup Indexes ---

                        // 1. Rhyme Index (Match from last stressed vowel to end)
                        // Stress markers in CMU are 1 (primary) or 2 (secondary)
                        let stressIdx = phonemes.findIndex(p => /[12]/.test(p));
                        if (stressIdx !== -1) {
                            const rhymeKey = phonemes.slice(stressIdx).join(' ');
                            if (!rhymeIndex[rhymeKey]) rhymeIndex[rhymeKey] = new Set();
                            rhymeIndex[rhymeKey].add(word);
                        }

                        // 2. Alliteration Index (Match starting consonants)
                        const first = phonemes[0];
                        if (first && !/[012]/.test(first)) { 
                            if (!alliterationIndex[first]) alliterationIndex[first] = new Set();
                            alliterationIndex[first].add(word);
                        }

                        // 3. Consonance / Near Rhyme (Match all consonants, strip vowels)
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

// --- 4. Core Editor Logic ---

function handleInput() {
    // Get text up to the current cursor position
    const cursorPosition = editor.selectionStart;
    const textUpToCursor = editor.value.slice(0, cursorPosition);
    
    // Find the last word typed based on cursor placement
    const words = textUpToCursor.trim().toUpperCase().split(/[^A-Z']+/);
    const targetWord = words[words.length - 1];

    if (!targetWord || targetWord === currentTargetWord) return;

    // Check if the word is in our dictionary
    if (dictionary[targetWord]) {
        currentTargetWord = targetWord;
        analyzeWord(targetWord);
    } else {
        // Optional: Indicate word not found
        targetWordSpan.textContent = targetWord.toLowerCase() + " (not found)";
    }
}

function analyzeWord(word) {
    targetWordSpan.textContent = word.toLowerCase();
    const phonemes = dictionary[word];
    
    // 1. Find Rhymes (O(1) Array from Set lookup)
    let stressIdx = phonemes.findIndex(p => /[12]/.test(p));
    let rhymes = [];
    if (stressIdx !== -1) {
        const rhymeKey = phonemes.slice(stressIdx).join(' ');
        rhymes = Array.from(rhymeIndex[rhymeKey] || []).filter(w => w !== word);
    }

    // 2. Find Alliteration
    let alliterations = [];
    const first = phonemes[0];
    if (first && !/[012]/.test(first)) {
        alliterations = Array.from(alliterationIndex[first] || []).filter(w => w !== word);
    }

    // 3. Find Consonance (Near Rhymes)
    let nearRhymes = [];
    const cons = phonemes.filter(p => !/[012]/.test(p)).join(' ');
    if (cons.length > 0) {
        // We filter out words that already appeared in the "Rhyme" section to prevent redundancy
        nearRhymes = Array.from(consonanceIndex[cons] || []).filter(w => w !== word && !rhymes.includes(w));
    }

    // Render to UI
    renderSuggestions(rhymeList, sortAndLimit(rhymes));
    renderSuggestions(alliterationList, sortAndLimit(alliterations));
    renderSuggestions(consonanceList, sortAndLimit(nearRhymes));
}

// --- 5. UI Helpers ---

function sortAndLimit(wordArray, limit = 40) {
    // Prioritize words that exist in your frequency.txt
    return wordArray.sort((a, b) => {
        const aFreq = frequencySet.has(a) ? 1 : 0;
        const bFreq = frequencySet.has(b) ? 1 : 0;
        return bFreq - aFreq; // Descending
    }).slice(0, limit);
}

function renderSuggestions(container, words) {
    container.innerHTML = ""; // Clear existing
    
    if (words.length === 0) {
        container.innerHTML = `<span style="color: #666; font-style: italic;">No matches found.</span>`;
        return;
    }

    words.forEach(word => {
        const span = document.createElement('span');
        span.className = 'word-badge';
        span.textContent = word.toLowerCase();
        
        // Bonus Feature: Clicking a suggestion inserts it at the cursor!
        span.onclick = () => insertWord(word.toLowerCase());
        
        container.appendChild(span);
    });
}

function insertWord(word) {
    const cursorPos = editor.selectionStart;
    const text = editor.value;
    
    // Insert word at cursor
    const newText = text.slice(0, cursorPos) + word + " " + text.slice(cursorPos);
    editor.value = newText;
    
    // Move cursor after the inserted word
    const newCursorPos = cursorPos + word.length + 1;
    editor.setSelectionRange(newCursorPos, newCursorPos);
    editor.focus();
    
    handleInput(); // Re-trigger analysis for the newly inserted word
}

// Utility: Debounce function to prevent lag while typing fast
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
