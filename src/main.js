import { Game } from './game.js';

const game = new Game(document.getElementById('app'), document.getElementById('ui'));
window.__game = game;
game.start();
