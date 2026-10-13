import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, StatusBar, BackHandler } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Ctx } from './src/store';
import { STR } from './src/i18n';
import { palette, ACCENTS } from './src/theme';
import { load } from './src/services/api';
import { USE_MOCK, API_URL } from './src/config';
import { notify, setWeekly } from './src/notify';
import { updateWidget } from './src/widget';
import Welcome from './src/screens/Welcome';
import Login from './src/screens/Login';
import Link from './src/screens/Link';
import Home from './src/screens/Home';
import Library from './src/screens/Library';
import Achievements from './src/screens/Achievements';
import Profile from './src/screens/Profile';
import Settings from './src/screens/Settings';

const TABS = { home: Home, lib: Library, ach: Achievements, prof: Profile, set: Settings };

export default function App() {
  const [lang, setLang] = useState('es');
  const [dark, setDark] = useState(false);
  const [accent, setAccent] = useState(ACCENTS.Azul);
  const [hc, setHc] = useState(false);
  const [view, setView] = useState(1);
  const [auto, setAuto] = useState(false);
  const [notif, setNotif] = useState([true, false, true]);
  const [links, setLinks] = useState({ steam: false, xbox: false });
  const [steamId, setSteamId] = useState('');
  const [scr, setScr] = useState('welcome');
  const [tab, setTab] = useState('home');
  const [data, setData] = useState({ games: [], now: null, avatars: {} });
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [avatarFrom, setAvatarFrom] = useState(null);
  const [toast, setToast] = useState('');
  const [f, setF] = useState('all');
  const [sort, setSort] = useState('h');
  const [achTab, setAchTab] = useState('got');
  const [ready, setReady] = useState(false);
  const timer = useRef(null);
  const prevEa = useRef(null);
  const failed = useRef(false);

  const t = (k) => STR[lang][k];
  const pal = palette(dark, hc);
  const say = (m) => {
    setToast(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2400);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await load(links, steamId);
      setData(d);
      setError(false);
      failed.current = false;
      const g = d.games.filter((x) => links[x.platform]);
      const ea = g.reduce((n, x) => n + x.achEarned, 0);
      const ta = g.reduce((n, x) => n + x.achTotal, 0);
      if (prevEa.current !== null && ea > prevEa.current && notif[0]) notify('Oasis', t('n1b'));
      prevEa.current = ea;
      const summary = { hours: g.reduce((n, x) => n + (x.hours || 0), 0), ach: `${ea}/${ta}`, games: g.length };
      AsyncStorage.setItem('oasis_summary', JSON.stringify(summary)).catch(() => {});
      updateWidget(summary);
    } catch (e) {
      setError(true);
      if (!failed.current && notif[2]) notify('Oasis', t('err'));
      failed.current = true;
    }
    setLoading(false);
  }, [links, steamId, notif, lang]);

  // Preferencias guardadas: se leen al abrir y se guardan en cada cambio.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('oasis_prefs');
        if (raw) {
          const p = JSON.parse(raw);
          if (p.lang) setLang(p.lang);
          if (typeof p.dark === 'boolean') setDark(p.dark);
          if (p.accent) setAccent(p.accent);
          if (typeof p.hc === 'boolean') setHc(p.hc);
          if (p.view) setView(p.view);
          if (typeof p.auto === 'boolean') setAuto(p.auto);
          if (Array.isArray(p.notif)) setNotif(p.notif);
          if (p.steamId) setSteamId(p.steamId);
          if (p.avatarFrom) setAvatarFrom(p.avatarFrom);
          if (p.links) {
            setLinks(p.links);
            if (p.links.steam || p.links.xbox) setScr('app');
          }
        }
      } catch (e) { /* sin datos guardados */ }
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const prefs = { lang, dark, accent, hc, view, auto, notif, links, steamId, avatarFrom };
    AsyncStorage.setItem('oasis_prefs', JSON.stringify(prefs)).catch(() => {});
  }, [ready, lang, dark, accent, hc, view, auto, notif, links, steamId, avatarFrom]);

  // Resumen semanal (lunes 9:00) segun el interruptor de notificaciones.
  useEffect(() => {
    if (ready) setWeekly(!!notif[1], 'Oasis', t('n2b'));
  }, [ready, notif[1], lang]);

  // Carga los datos al entrar a la app y cada vez que cambian las cuentas vinculadas.
  useEffect(() => {
    if (scr === 'app') refresh();
  }, [scr, links]);

  // Actualizacion automatica (cada 60 s).
  useEffect(() => {
    if (!auto || scr !== 'app') return undefined;
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [auto, scr, refresh]);

  // Boton "atras" de Android.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (scr === 'app') {
        if (tab === 'set') { setTab('prof'); return true; }
        if (tab !== 'home') { setTab('home'); return true; }
        return false;
      }
      if (scr === 'link') { setScr('login'); return true; }
      if (scr === 'login') { setScr('welcome'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [scr, tab]);

  // Solo se muestran las cuentas que estan vinculadas.
  const games = useMemo(() => data.games.filter((g) => links[g.platform]), [data, links]);

  // Steam: inicio de sesion oficial (OpenID) a traves del servidor. Con USE_MOCK es simulado.
  const steamLogin = async () => {
    if (USE_MOCK) return 'mock';
    try {
      const redirect = Linking.createURL('auth');
      const r = await WebBrowser.openAuthSessionAsync(`${API_URL}/auth/steam?app=${encodeURIComponent(redirect)}`, redirect);
      if (r.type === 'success') {
        const q = Linking.parse(r.url).queryParams || {};
        if (q.steamid) return String(q.steamid);
      }
    } catch (e) { /* se informa abajo */ }
    return null;
  };

  const linkAccount = async (p) => {
    if (p === 'steam') {
      const id = await steamLogin();
      if (!id) { say(t('autherr')); return false; }
      if (id !== 'mock') setSteamId(id);
    }
    setLinks((l) => ({ ...l, [p]: true }));
    return true;
  };

  const toggleLink = async (p) => {
    const other = p === 'steam' ? 'xbox' : 'steam';
    if (!links[p]) { await linkAccount(p); return; }
    if (scr === 'app' && !links[other]) { say(t('need')); return; }
    if (avatarFrom === p) setAvatarFrom(null);
    setF('all');
    setLinks({ ...links, [p]: false });
  };

  const ctx = {
    t, pal, accent, setAccent, dark, setDark, hc, setHc, lang, setLang, view, setView, auto, setAuto, notif, setNotif,
    links, setLinks, linkAccount, toggleLink, steamId, setSteamId, scr, setScr, tab, setTab, data, games, now: data.now,
    error, loading, refresh, avatarFrom, setAvatarFrom, say, f, setF, sort, setSort, achTab, setAchTab,
  };

  const Body = scr === 'welcome' ? Welcome : scr === 'login' ? Login : scr === 'link' ? Link : TABS[tab];
  const cur = tab === 'set' ? 'prof' : tab;

  if (!ready) return null;

  return (
    <Ctx.Provider value={ctx}>
      <View style={{ flex: 1, backgroundColor: pal.bg, paddingTop: StatusBar.currentHeight || 0 }}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} backgroundColor={pal.bg} />
        <View style={{ flex: 1 }}><Body /></View>
        {scr === 'app' ? (
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: pal.card, borderTopWidth: 1, borderTopColor: pal.line }}>
            {['home', 'lib', 'ach', 'prof'].map((k) => (
              <Pressable
                key={k}
                accessibilityRole="tab"
                accessibilityLabel={t(k)}
                accessibilityState={{ selected: cur === k }}
                onPress={() => setTab(k)}
                style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderTopColor: cur === k ? accent : 'transparent' }}
              >
                <Text style={{ color: cur === k ? accent : pal.muted, fontWeight: '600' }}>{t(k)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {toast ? (
          <View accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 16, right: 16, bottom: scr === 'app' ? 72 : 24, backgroundColor: pal.text, padding: 12, borderRadius: 12 }}>
            <Text style={{ color: pal.bg }}>{toast}</Text>
          </View>
        ) : null}
      </View>
    </Ctx.Provider>
  );
}
