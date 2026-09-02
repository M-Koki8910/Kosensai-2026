// ============================================================
// システム全体の進行状態定義
// ============================================================

const STATES = {
    START: 'START',
    READY: 'READY',
    ANIMATING: 'ANIMATING',
    RESULT: 'RESULT',
    FINISHED: 'FINISHED'
};

const WAITING_GUIDE_STEPS = [
    '1. GUIDE_TEXT',
    '2. GUIDE_TEXT',
    '3. GUIDE_TEXT',
    '4. GUIDE_TEXT',
    '5. GUIDE_TEXT'
];

const WAITING_NOTES = [
    '・NOTE_TEXT',
    '・NOTE_TEXT',
    '・NOTE_TEXT',
    '・NOTE_TEXT',
    '・NOTE_TEXT'
];

let currentState = STATES.START;


// ============================================================
// 各種データプール
// ============================================================

let masterPrizes = [];
let masterParticipants = [];

let activePrizes = [];
let activeParticipants = [];


// ============================================================
// 進行トラッキング
// ============================================================

let currentGradeIndex = 0;
let maxDrawCountPerTurn = 5;


// ============================================================
// デバッグ設定
// ============================================================

// デバッグモードが有効か
let debugMode = false;

// 強制当選する抽選番号
let debugParticipantId = null;

// 強制的に割り当てる景品番号
let debugItemNum = null;

// デバッグ対象の等番号
// 景品番号の先頭1桁から自動的に決定する
let debugGradeNum = null;

// Pキー連打検出
let pKeyCount = 0;
let pKeyTimer = null;

const DEBUG_P_KEY_LIMIT = 10;
const DEBUG_P_KEY_WINDOW = 5000;


// ============================================================
// 音声
// ============================================================

const soundRoll = document.getElementById('sound-roll');
const soundStop = document.getElementById('sound-stop');
const soundFinish = document.getElementById('sound-finish');


// ============================================================
// 各種画面要素
// ============================================================

const screenStart = document.getElementById('screen-start');
const screenWait = document.getElementById('screen-waiting');
const screenDraw = document.getElementById('screen-draw');
const screenConfig = document.getElementById('screen-config');


// ============================================================
// 景品画像パス
// ============================================================

function normalizePrizeImagePath(value) {

    if (!value) {
        return '/images/logo.png';
    }

    const normalized = String(value).trim();

    if (normalized.startsWith('/')) {
        return normalized;
    }

    if (normalized.startsWith('./')) {
        return `/${normalized.replace(/^\.\/?/, '')}`;
    }

    if (normalized.startsWith('../')) {
        return `/${normalized.replace(/^\.\.\/?/, '')}`;
    }

    return `/${normalized.replace(/^\/+/, '')}`;
}


// ============================================================
// トラック生成
// ============================================================

function createRepeatedTrack(items, mapper) {

    const repeated = [...items, ...items];

    return repeated.map(mapper).join('');
}


// ============================================================
// 待機画面
// ============================================================

function renderWaitingScreen() {

    const stepList = document.getElementById('wait-step-list');
    const noteList = document.getElementById('wait-note-list');
    const prizeList = document.getElementById('wait-prize-list');

    if (!stepList || !noteList || !prizeList) {
        return;
    }

    stepList.innerHTML = createRepeatedTrack(
        WAITING_GUIDE_STEPS,
        (step) => `
            <div class="lane-item text-item">
                ${step}
            </div>
        `
    );

    noteList.innerHTML = createRepeatedTrack(
        WAITING_NOTES,
        (note) => `
            <div class="lane-item text-item">
                ${note}
            </div>
        `
    );

    const prizeCards = masterPrizes.flatMap((grade) =>
        grade.items.map((item) => {

            return `
                <div class="prize-card">
                    <strong>${item.item_name}</strong>
                </div>
            `;
        })
    );

    prizeList.innerHTML = createRepeatedTrack(
        prizeCards,
        (card) => `
            <div class="lane-item prize-item">
                ${card}
            </div>
        `
    );
}


// ============================================================
// 時計
// ============================================================

function updateWaitingClock() {

    const clock = document.getElementById('waiting-clock');

    if (!clock) {
        return;
    }

    const now = new Date();

    clock.textContent = now.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit'
    });
}


// ============================================================
// 待機画面表示
// ============================================================

function showWaitingScreen() {

    if (!screenWait || !screenStart || !screenDraw || !screenConfig) {
        return;
    }

    screenStart.style.display = 'none';
    screenConfig.style.display = 'none';
    screenDraw.style.display = 'none';
    screenWait.style.display = 'flex';

    renderWaitingScreen();
    updateWaitingClock();
}


// ============================================================
// スタート画面表示
// ============================================================

function showStartScreen() {

    if (!screenWait || !screenStart || !screenDraw || !screenConfig) {
        return;
    }

    screenWait.style.display = 'none';
    screenDraw.style.display = 'none';
    screenConfig.style.display = 'none';
    screenStart.style.display = 'flex';
}


// ============================================================
// データ読み込み
// ============================================================

async function loadData() {

    try {

        const [prizesRes, participantsRes] = await Promise.all([
            fetch('prizes.json'),
            fetch('participants.json')
        ]);

        if (!prizesRes.ok || !participantsRes.ok) {
            throw new Error('JSONの読み込みに失敗しました');
        }

        masterPrizes = await prizesRes.json();
        masterParticipants = await participantsRes.json();

        // 設定値復元
        const savedCount =
            localStorage.getItem('lottery_max_draw_count');

        if (savedCount) {

            maxDrawCountPerTurn =
                parseInt(savedCount, 10);

            document.getElementById(
                'config-draw-count'
            ).value = maxDrawCountPerTurn;
        }

        document.getElementById(
            'start-load-status'
        ).textContent =
            "📦 データの読み込み完了";

        renderWaitingScreen();
        updateWaitingClock();
        buildConfigDataTables();

    } catch (e) {

        console.error(e);

        document.getElementById(
            'start-load-status'
        ).textContent =
            "❌ データ読み込み失敗";
    }
}


// ============================================================
// 抽選セッション開始
// ============================================================

function startLotterySession() {

    if (
        masterPrizes.length === 0 ||
        masterParticipants.length === 0
    ) {

        alert(
            "データが正常に読み込まれていません。"
        );

        return;
    }

    // ディープコピー
    activePrizes =
        JSON.parse(JSON.stringify(masterPrizes));

    activeParticipants =
        JSON.parse(JSON.stringify(masterParticipants));

    currentGradeIndex = 0;

    // 画面切り替え
    screenWait.style.display = 'none';
    screenStart.style.display = 'none';
    screenConfig.style.display = 'none';
    screenDraw.style.display = 'flex';

    moveToState(STATES.READY);
}


// ============================================================
// 状態遷移
// ============================================================

function moveToState(nextState) {

    currentState = nextState;

    if (
        currentGradeIndex >=
        activePrizes.length
    ) {

        currentState = STATES.FINISHED;
    }

    const drawBadge =
        document.getElementById('grade-badge');

    const prizeTitle =
        document.getElementById('prize-title');

    const statusMessage =
        document.getElementById('status-message');

    const actionBtn =
        document.getElementById('action-btn');


    switch (currentState) {

        // ----------------------------------------------------
        // 抽選待機
        // ----------------------------------------------------

        case STATES.READY: {

            const currentGrade =
                activePrizes[currentGradeIndex];

            drawBadge.textContent =
                currentGrade.grade_name;

            const availableItemsCount =
                currentGrade.items.length;

            const currentTurnCount =
                Math.min(
                    maxDrawCountPerTurn,
                    availableItemsCount
                );

            prizeTitle.textContent =
                `${currentGrade.grade_name} 抽選 ` +
                `(残り ${availableItemsCount} つ中 ` +
                `${currentTurnCount} つ)`;

            statusMessage.textContent =
                "Spaceキーまたはボタンで抽選開始";

            actionBtn.textContent =
                "抽選開始";

            actionBtn.disabled = false;

            setupBlankCards(currentTurnCount);

            break;
        }


        // ----------------------------------------------------
        // 抽選中
        // ----------------------------------------------------

        case STATES.ANIMATING:

            statusMessage.textContent =
                "パタパタ抽選中...";

            actionBtn.disabled = true;

            if (soundRoll) {

                soundRoll.currentTime = 0;

                soundRoll.play().catch(() => {});
            }

            executeDrawSequence();

            break;


        // ----------------------------------------------------
        // 結果
        // ----------------------------------------------------

        case STATES.RESULT:

            if (soundRoll) {
                soundRoll.pause();
            }

            statusMessage.textContent =
                "Enterキーまたはボタンで次へ進む";

            actionBtn.textContent =
                "次へ";

            actionBtn.disabled = false;

            break;


        // ----------------------------------------------------
        // 終了
        // ----------------------------------------------------

        case STATES.FINISHED:

            if (soundRoll) {
                soundRoll.pause();
            }

            drawBadge.style.display =
                'none';

            prizeTitle.textContent =
                "すべての抽選が終了しました";

            statusMessage.textContent =
                "本日の抽選会はすべて終了です。ありがとうございました！";

            actionBtn.textContent =
                "終了";

            actionBtn.disabled = true;

            document.getElementById(
                'result-container'
            ).innerHTML = "";

            break;
    }
}


// ============================================================
// マスクカード生成
// ============================================================

function setupBlankCards(count) {

    const container =
        document.getElementById(
            'result-container'
        );

    container.innerHTML = '';

    for (let i = 0; i < count; i++) {

        const card =
            document.createElement('div');

        card.className =
            'winner-card';

        card.innerHTML = `

            <div>

                <div class="box-label ticket">
                    抽選番号
                </div>

                <div class="ticket-box">

                    <div class="flap-digit">?</div>
                    <div class="flap-digit">?</div>
                    <div class="flap-digit">?</div>
                    <div class="flap-digit">?</div>

                </div>

            </div>


            <div>

                <div class="box-label item">
                    景品番号
                </div>

                <div class="item-box">

                    <div class="flap-digit">?</div>
                    <div class="flap-digit">?</div>
                    <div class="flap-digit">?</div>

                </div>

            </div>


            <div class="item-text-name">
                ???
            </div>
        `;

        container.appendChild(card);
    }
}


// ============================================================
// デバッグ機能
// ============================================================
//
// 景品番号の先頭1桁から対象等を決定する
//
// 例:
// 503 → 5等
// 401 → 4等
// 201 → 2等
//
// ============================================================

function setDebugTarget(participantId, itemNum) {

    const participantString =
        String(participantId).trim();

    const itemString =
        String(itemNum).trim();


    // 抽選番号チェック
    if (!/^\d+$/.test(participantString)) {

        alert(
            "抽選番号は数字で指定してください。"
        );

        return false;
    }


    // 景品番号チェック
    if (!/^\d{3}$/.test(itemString)) {

        alert(
            "景品番号は3桁の数字で指定してください。"
        );

        return false;
    }


    // 景品番号の先頭1桁
    const gradeNum =
        parseInt(itemString.charAt(0), 10);


    // 指定された参加者が存在するか
    const participantExists =
        masterParticipants.some(
            p => String(p.id) === participantString
        );

    if (!participantExists) {

        alert(
            `抽選番号 ${participantString} は参加者データに存在しません。`
        );

        return false;
    }


    // 指定された景品が存在するか
    let targetItem = null;
    let targetGrade = null;

    for (const grade of masterPrizes) {

        const found =
            grade.items.find(
                item =>
                    String(item.item_num) ===
                    itemString
            );

        if (found) {

            targetItem = found;
            targetGrade = grade;

            break;
        }
    }


    if (!targetItem) {

        alert(
            `景品番号 ${itemString} は景品データに存在しません。`
        );

        return false;
    }


    // 景品番号の先頭1桁と実際の等番号を確認
    const actualGradeNum =
        parseInt(
            String(targetGrade.grade_num),
            10
        );

    if (gradeNum !== actualGradeNum) {

        alert(
            `景品番号 ${itemString} は ` +
            `${gradeNum}等を示していますが、` +
            `データ上では${actualGradeNum}等に登録されています。`
        );

        return false;
    }


    // 設定
    debugMode = true;

    debugParticipantId =
        participantString;

    debugItemNum =
        itemString;

    debugGradeNum =
        gradeNum;


    return true;
}


// ============================================================
// デバッグ設定画面の表示
// ============================================================

function syncDebugInputFields() {
    const participantInput =
        document.getElementById('debug-participant-input') ||
        document.getElementById('debug-participant-id');

    const itemInput =
        document.getElementById('debug-item-input') ||
        document.getElementById('debug-item-num');

    if (participantInput) {
        participantInput.value =
            debugMode ? debugParticipantId || '' : '';
    }

    if (itemInput) {
        itemInput.value =
            debugMode ? debugItemNum || '' : '';
    }
}


function showDebugPanel() {

    let panel =
        document.getElementById('debug-panel');

    if (!panel) {

        panel =
            document.createElement('div');

        panel.id =
            'debug-panel';

        panel.innerHTML = `

            <div class="debug-panel-inner">

                <div class="debug-title">
                    DEBUG MODE
                </div>

                <div class="debug-row">

                    <label>
                        抽選番号
                    </label>

                    <input
                        type="text"
                        id="debug-participant-input"
                        inputmode="numeric"
                        maxlength="4"
                        placeholder="例: 0123"
                    >

                </div>


                <div class="debug-row">

                    <label>
                        景品番号
                    </label>

                    <input
                        type="text"
                        id="debug-item-input"
                        inputmode="numeric"
                        maxlength="3"
                        placeholder="例: 503"
                    >

                </div>


                <div class="debug-buttons">

                    <button
                        id="debug-set-btn"
                        type="button"
                    >
                        指定する
                    </button>

                    <button
                        id="debug-clear-btn"
                        type="button"
                    >
                        指定を解除
                    </button>

                    <button
                        id="debug-close-btn"
                        type="button"
                    >
                        閉じる
                    </button>

                </div>


                <div
                    id="debug-status"
                    class="debug-status"
                >
                    未設定
                </div>

            </div>
        `;

        document.body.appendChild(panel);


        // --------------------------------------------
        // 指定する
        // --------------------------------------------

        document
            .getElementById('debug-set-btn')
            .addEventListener(
                'click',
                () => {

                    const participant =
                        document.getElementById(
                            'debug-participant-input'
                        ).value;

                    const item =
                        document.getElementById(
                            'debug-item-input'
                        ).value;


                    if (
                        setDebugTarget(
                            participant,
                            item
                        )
                    ) {

                        updateDebugStatus();
                    }
                }
            );


        // --------------------------------------------
        // 指定解除
        // --------------------------------------------

        document
            .getElementById('debug-clear-btn')
            .addEventListener(
                'click',
                clearDebugTarget
            );


        // --------------------------------------------
        // 画面を閉じる
        // --------------------------------------------

        document
            .getElementById('debug-close-btn')
            .addEventListener(
                'click',
                () => {

                    panel.classList.remove(
                        'visible'
                    );

                }
            );
    }


    syncDebugInputFields();

    updateDebugStatus();

    panel.classList.add('visible');
}


// ============================================================
// デバッグ設定表示
// ============================================================

function updateDebugStatus() {

    const status =
        document.getElementById(
            'debug-status'
        );

    if (!status) {
        return;
    }

    if (!debugMode) {

        status.textContent =
            "未設定";

        return;
    }

    status.textContent =
        `指定中：抽選番号 ${debugParticipantId}` +
        ` → 景品番号 ${debugItemNum}` +
        `（${debugGradeNum}等で強制当選）`;
}


// ============================================================
// デバッグ解除
// ============================================================

function clearDebugTarget() {

    debugMode = false;

    debugParticipantId = null;
    debugItemNum = null;
    debugGradeNum = null;

    syncDebugInputFields();
    updateDebugStatus();
}


// ============================================================
// デバッグ対象が現在の等か
// ============================================================

function isDebugGrade(grade) {

    if (!debugMode) {
        return false;
    }

    return (
        parseInt(
            String(grade.grade_num),
            10
        ) === debugGradeNum
    );
}


// ============================================================
// 指定景品を取得
// ============================================================

function findDebugItem(grade) {

    if (!debugMode) {
        return null;
    }

    if (!isDebugGrade(grade)) {
        return null;
    }

    return grade.items.find(
        item =>
            String(item.item_num) ===
            String(debugItemNum)
    );
}


// ============================================================
// コア抽選ロジック
// ============================================================

let currentTurnResults = [];

function executeDrawSequence() {

    const currentGrade =
        activePrizes[currentGradeIndex];

    const availableItemsCount =
        currentGrade.items.length;

    const currentTurnCount =
        Math.min(
            maxDrawCountPerTurn,
            availableItemsCount
        );


    currentTurnResults = [];


    // --------------------------------------------------------
    // デバッグモード
    // --------------------------------------------------------
    //
    // 指定された景品番号の等に到達した場合、
    // 指定参加者 + 指定景品を必ず最初の枠に割り当てる
    //
    // --------------------------------------------------------

    if (isDebugGrade(currentGrade)) {

        const debugItem =
            findDebugItem(currentGrade);

        const participantIndex =
            activeParticipants.findIndex(
                p =>
                    String(p.id) ===
                    String(debugParticipantId)
            );


        if (debugItem && participantIndex !== -1) {

            // 指定景品を景品プールから削除
            const itemIndex =
                currentGrade.items.findIndex(
                    item =>
                        String(item.item_num) ===
                        String(debugItem.item_num)
                );

            if (itemIndex !== -1) {

                const chosenItem =
                    currentGrade.items.splice(
                        itemIndex,
                        1
                    )[0];


                // 指定参加者をプールから削除
                const winner =
                    activeParticipants.splice(
                        participantIndex,
                        1
                    )[0];


                // 必ず指定ペアで結果を作る
                currentTurnResults.push({

                    participantId:
                        winner.id,

                    itemNum:
                        chosenItem.item_num,

                    itemName:
                        chosenItem.item_name
                });
            }
        }
    }


    // --------------------------------------------------------
    // 残りの通常抽選
    // --------------------------------------------------------

    while (
        currentTurnResults.length <
            currentTurnCount &&
        activeParticipants.length > 0 &&
        currentGrade.items.length > 0
    ) {

        // 景品をランダム選択
        const itemIdx =
            Math.floor(
                Math.random() *
                currentGrade.items.length
            );

        const chosenItem =
            currentGrade.items.splice(
                itemIdx,
                1
            )[0];


        // 重み付き抽選
        const totalWeight =
            activeParticipants.reduce(
                (sum, p) =>
                    sum + Number(p.weight),
                0
            );


        const randomValue =
            Math.random() *
            totalWeight;


        let currentSum = 0;
        let winnerIndex = -1;


        for (
            let j = 0;
            j < activeParticipants.length;
            j++
        ) {

            currentSum +=
                Number(
                    activeParticipants[j].weight
                );

            if (
                randomValue <=
                currentSum
            ) {

                winnerIndex = j;

                break;
            }
        }


        if (winnerIndex !== -1) {

            const winner =
                activeParticipants.splice(
                    winnerIndex,
                    1
                )[0];


            currentTurnResults.push({

                participantId:
                    winner.id,

                itemNum:
                    chosenItem.item_num,

                itemName:
                    chosenItem.item_name
            });
        }
    }


    // アニメーション
    animateFlaps();
}


// ============================================================
// パタパタ演出
// ============================================================

function animateFlaps() {

    const container =
        document.getElementById(
            'result-container'
        );

    const cards =
        container.querySelectorAll(
            '.winner-card'
        );


    // 全桁ローリング開始
    cards.forEach(card => {

        card
            .querySelectorAll('.flap-digit')
            .forEach(digit => {

                digit.classList.add(
                    'rolling'
                );


                const intervalId =
                    setInterval(() => {

                        digit.textContent =
                            Math.floor(
                                Math.random() * 10
                            );

                    }, 40);


                digit.dataset.intervalId =
                    intervalId;
            });
    });


    const stepDelay = 1500;


    // 4桁 + 3桁
    for (
        let step = 0;
        step < 7;
        step++
    ) {

        setTimeout(() => {

            let anyDigitStopped = false;


            cards.forEach(
                (card, cardIdx) => {

                    if (
                        !currentTurnResults[
                            cardIdx
                        ]
                    ) {
                        return;
                    }


                    const ticketDigits =
                        card.querySelectorAll(
                            '.ticket-box .flap-digit'
                        );

                    const itemDigits =
                        card.querySelectorAll(
                            '.item-box .flap-digit'
                        );


                    let targetDigit = null;
                    let finalChar = "0";


                    // 抽選番号
                    if (step < 4) {

                        targetDigit =
                            ticketDigits[step];


                        const fullStr =
                            String(
                                currentTurnResults[
                                    cardIdx
                                ].participantId
                            ).padStart(4, '0');


                        finalChar =
                            fullStr[step];

                    }

                    // 景品番号
                    else {

                        targetDigit =
                            itemDigits[
                                step - 4
                            ];


                        const fullStr =
                            String(
                                currentTurnResults[
                                    cardIdx
                                ].itemNum
                            ).padStart(3, '0');


                        finalChar =
                            fullStr[
                                step - 4
                            ];
                    }


                    if (
                        targetDigit &&
                        targetDigit.classList.contains(
                            'rolling'
                        )
                    ) {

                        clearInterval(
                            targetDigit.dataset.intervalId
                        );


                        targetDigit.classList.remove(
                            'rolling'
                        );


                        targetDigit.textContent =
                            finalChar;


                        anyDigitStopped =
                            true;
                    }
                }
            );


            // 桁確定音
            if (
                anyDigitStopped &&
                soundStop
            ) {

                const cloneStopSound =
                    soundStop.cloneNode();

                cloneStopSound.volume =
                    soundStop.volume;

                cloneStopSound
                    .play()
                    .catch(() => {});
            }


            // 最終桁
            if (step === 6) {

                if (soundRoll) {
                    soundRoll.pause();
                }


                const delayForSE = 1000;


                setTimeout(() => {

                    // 最終確定音
                    if (soundFinish) {

                        const finalSound =
                            soundFinish.cloneNode();

                        finalSound.volume =
                            soundFinish.volume;

                        finalSound
                            .play()
                            .catch(() => {});
                    }


                    // 景品名表示
                    cards.forEach(
                        (c, idx) => {

                            if (
                                currentTurnResults[
                                    idx
                                ]
                            ) {

                                c.querySelector(
                                    '.item-text-name'
                                ).textContent =
                                    currentTurnResults[
                                        idx
                                    ].itemName;
                            }
                        }
                    );


                    setTimeout(() => {

                        moveToState(
                            STATES.RESULT
                        );

                    }, 600);


                }, delayForSE);
            }

        }, (step + 1) * stepDelay);
    }
}


// ============================================================
// 次へ
// ============================================================

function handlePrimaryAction() {

    if (
        currentState === STATES.READY
    ) {

        moveToState(
            STATES.ANIMATING
        );

    }

    else if (
        currentState === STATES.RESULT
    ) {

        if (
            activePrizes[
                currentGradeIndex
            ].items.length === 0
        ) {

            currentGradeIndex++;
        }

        moveToState(
            STATES.READY
        );
    }
}


// ============================================================
// 設定画面データ表示
// ============================================================

function buildConfigDataTables() {

    document.getElementById(
        'count-prizes-label'
    ).textContent =
        masterPrizes.length;


    document.getElementById(
        'count-participants-label'
    ).textContent =
        masterParticipants.length;


    const tbodyPrizes =
        document.querySelector(
            '#table-prizes tbody'
        );

    tbodyPrizes.innerHTML = '';


    masterPrizes.forEach(g => {

        g.items.forEach(item => {

            const tr =
                document.createElement('tr');

            tr.innerHTML = `
                <td>${g.grade_num}</td>
                <td>
                    <strong>
                        ${g.grade_name}
                    </strong>
                </td>
                <td>
                    <code>
                        [${item.item_num}]
                    </code>
                    ${item.item_name}
                </td>
            `;

            tbodyPrizes.appendChild(tr);
        });
    });


    const tbodyParticipants =
        document.querySelector(
            '#table-participants tbody'
        );

    tbodyParticipants.innerHTML = '';


    masterParticipants.forEach(p => {

        const tr =
            document.createElement('tr');

        tr.innerHTML = `
            <td>
                <code>
                    ${p.id}
                </code>
            </td>

            <td>
                ${p.weight} 口
            </td>
        `;

        tbodyParticipants.appendChild(tr);
    });
}


// ============================================================
// Pキー10回連続入力
// ============================================================

window.addEventListener(
    'keydown',
    (e) => {

        // 入力欄に文字を入力しているときは無視
        if (
            e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA'
        ) {
            return;
        }


        if (
            e.key.toLowerCase() !== 'p'
        ) {
            return;
        }


        pKeyCount++;


        // 最初のPから5秒経過したらリセット
        if (pKeyCount === 1) {

            pKeyTimer =
                setTimeout(() => {

                    pKeyCount = 0;
                    pKeyTimer = null;

                }, DEBUG_P_KEY_WINDOW);
        }


        // 10回到達
        if (
            pKeyCount >=
            DEBUG_P_KEY_LIMIT
        ) {

            clearTimeout(pKeyTimer);

            pKeyTimer = null;
            pKeyCount = 0;

            showDebugPanel();
        }
    }
);


// ============================================================
// スタート画面ボタン
// ============================================================

document
    .getElementById('start-draw-btn')
    .addEventListener(
        'click',
        startLotterySession
    );


document
    .getElementById('open-waiting-btn')
    .addEventListener(
        'click',
        showWaitingScreen
    );


document
    .getElementById('open-config-btn')
    .addEventListener(
        'click',
        () => {

            screenStart.style.display =
                'none';

            screenConfig.style.display =
                'flex';
        }
    );


document
    .getElementById(
        'back-to-start-from-waiting'
    )
    .addEventListener(
        'click',
        showStartScreen
    );


document
    .getElementById(
        'open-draw-from-waiting'
    )
    .addEventListener(
        'click',
        startLotterySession
    );


// ============================================================
// 設定保存
// ============================================================

document
    .getElementById('save-config-btn')
    .addEventListener(
        'click',
        () => {

            const val =
                parseInt(
                    document.getElementById(
                        'config-draw-count'
                    ).value,
                    10
                );


            if (val >= 1) {

                maxDrawCountPerTurn =
                    val;


                localStorage.setItem(
                    'lottery_max_draw_count',
                    val
                );


                alert(
                    "一度の同時抽選数を保存しました！"
                );
            }
        }
    );


// ============================================================
// 設定画面を閉じる
// ============================================================

document
    .getElementById('close-config-btn')
    .addEventListener(
        'click',
        () => {

            screenConfig.style.display =
                'none';

            screenStart.style.display =
                'flex';
        }
    );


// ============================================================
// 抽選画面からスタート画面へ
// ============================================================

document
    .getElementById('back-to-start-draw')
    .addEventListener(
        'click',
        () => {

            if (
                confirm(
                    "現在の抽選履歴を破棄してスタート画面に戻ります。よろしいですか？"
                )
            ) {

                if (soundRoll) {
                    soundRoll.pause();
                }


                screenWait.style.display =
                    'none';

                screenDraw.style.display =
                    'none';

                screenStart.style.display =
                    'flex';


                currentState =
                    STATES.START;
            }
        }
    );


// ============================================================
// メインアクションボタン
// ============================================================

document
    .getElementById('action-btn')
    .addEventListener(
        'click',
        handlePrimaryAction
    );


// ============================================================
// キーボード操作
// ============================================================

window.addEventListener(
    'keydown',
    (e) => {

        if (
            currentState === STATES.START
        ) {
            return;
        }


        if (
            e.code === 'Space'
        ) {

            e.preventDefault();

            if (
                currentState ===
                STATES.READY
            ) {

                handlePrimaryAction();
            }
        }


        if (
            e.code === 'Enter'
        ) {

            e.preventDefault();

            if (
                currentState ===
                STATES.RESULT
            ) {

                handlePrimaryAction();
            }
        }
    }
);


// ============================================================
// 起動
// ============================================================

loadData();

setInterval(
    updateWaitingClock,
    30000
);