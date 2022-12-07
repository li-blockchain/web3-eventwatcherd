const admin = require('firebase-admin');
const { createAlchemyWeb3 } = require("@alch/alchemy-web3");
require('dotenv').config();

const serviceAccount = require("./service-account.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const web3 = createAlchemyWeb3(`wss://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);

const listeners = [];

// 1. Read our listeners from the firestore db.
const readListeners = async () => {
    const snapshot = await db.collection('listeners').get();
    snapshot.forEach(doc => {
        listeners.push(doc.data());
    });
}

// 2. Listen for events from the chain.
const listenForEvents = async () => {
    listeners.forEach(async listener => {
        const contract = new web3.eth.Contract([listener.event], listener.contract);

        console.log("Listening for events from contract: ", listener.contract);

        contract.events[listener.event.name]({}).on('connected', (subscriptionId) => {
            console.log("Subscription ID: ", subscriptionId);
        }).on('data', async (event) => {
            console.log("Event detected!");
            console.log("Event: ", event);
            console.log("Event Data: ", event.returnValues);
            console.log("Event Block: ", event.blockNumber);
            console.log("Event Transaction hash: ", event.transactionHash);

            let tx = await web3.eth.getTransaction(event.transactionHash);

            const now = new Date();
            const nowUTC = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
            console.log("UTC: ", nowUTC);

            // 3. Call the HTTP endpoint.
            const response = await fetch(listener.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    event: event.returnValues,
                    block: event.blockNumber,
                    tx,
                    timestamp: nowUTC
                })
            }).catch((error) => {
                console.log("Error: ", error);
            });
        }).on('error', (error) => { 
            console.log("Error: ", error);
        });
    });
}

// 4. Watch for changes in the listeners.
const watchForChanges = async () => {
    db.collection('listeners').onSnapshot(async (snapshot) => {
        console.log("Change detected!");
        listeners.length = 0;
        web3.eth.clearSubscriptions();
        await readListeners();
        await listenForEvents();
    });
}

// IFFY to run our functions.
(async () => {
    await readListeners();
    await listenForEvents();
    await watchForChanges();
})();