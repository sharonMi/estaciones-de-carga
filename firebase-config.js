const firebaseConfig = {

  apiKey: "AIzaSyAmTPc2ruIn6gsuSlK-KCIncTxucuueh38",

  authDomain: "estaciones-de-carga-9849c.firebaseapp.com",

  projectId: "estaciones-de-carga-9849c",

  storageBucket: "estaciones-de-carga-9849c.firebasestorage.app",

  messagingSenderId: "839992375678",

  appId: "1:839992375678:web:7819e9c82a4cfb5d3f5b2f",

  measurementId: "G-3H4009H5J4"

};

firebase.initializeApp(firebaseConfig);

const fbAuth = firebase.auth();
const fbDb   = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();
