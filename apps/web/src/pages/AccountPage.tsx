import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@pokerorga/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Section, Segmented, Toggle, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useMe } from '../lib/auth';

export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [f, setF] = useState<Partial<User>>({});
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  useEffect(() => {
    if (me.data) setF(me.data);
  }, [me.data]);
  if (!me.data) return null;
  const saveProfile = async () => {
    try {
      const r = await api.patch<{ user: User }>('/account', {
        firstName: f.firstName ?? null,
        lastName: f.lastName ?? null,
        pseudo: f.pseudo ?? null,
        clubName: f.clubName ?? null,
        usageMode: f.usageMode,
        rakeEnabled: f.usageMode === 'association' ? false : f.rakeEnabled,
      });
      qc.setQueryData(['me'], r.user);
      toast('Profil mis à jour avec succès !');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur réseau.', 'error');
    }
  };
  const changePw = async () => {
    try {
      await api.post('/account/password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast('Mot de passe mis à jour avec succès !');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur réseau.', 'error');
    }
  };
  return (
    <>
      <PageHeader title={`Bonjour${me.data.pseudo ? `, ${me.data.pseudo}` : ''} 👋`} subtitle={me.data.email} />
      {sp.get('welcome') && <div className="mb-5 rounded-xl border border-gold-500/40 bg-gold-500/10 p-4 text-sm">Bienvenue ! Complétez votre profil pour personnaliser votre expérience, puis ouvrez votre timer depuis le menu.</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Mes informations" subtitle="Complétez votre profil pour personnaliser votre expérience.">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Prénom</label>
                <input className="input" value={f.firstName ?? ''} onChange={(e) => setF({ ...f, firstName: e.target.value })} placeholder="Votre prénom" />
              </div>
              <div>
                <label className="label">Nom</label>
                <input className="input" value={f.lastName ?? ''} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder="Votre nom" />
              </div>
            </div>
            <div>
              <label className="label">Mon pseudo</label>
              <input className="input" value={f.pseudo ?? ''} onChange={(e) => setF({ ...f, pseudo: e.target.value })} placeholder="Votre pseudo" />
            </div>
            <div>
              <label className="label">Nom de mon club</label>
              <input className="input" value={f.clubName ?? ''} onChange={(e) => setF({ ...f, clubName: e.target.value })} placeholder="Nom de votre club" />
              <p className="mt-1 text-xs text-stone-500">Affiché sur les pages publiques (classements, inscriptions).</p>
            </div>
            <div>
              <label className="label">Cadre d'utilisation</label>
              <Segmented
                value={f.usageMode ?? 'private'}
                onChange={(v) => setF({ ...f, usageMode: v })}
                options={[
                  { value: 'private', label: 'Privé' },
                  { value: 'association', label: 'Club associatif' },
                ]}
              />
              {f.usageMode === 'association' && <p className="mt-2 text-xs text-stone-400">Cadre associatif : privilégiez les tournois gratuits ou dotés en lots ; le rake est désactivé.</p>}
            </div>
            {f.usageMode !== 'association' && <Toggle checked={!!f.rakeEnabled} onChange={(v) => setF({ ...f, rakeEnabled: v })} label="Activer le rake" hint="Permet de prélever un montant par entrée sur le prize pool" />}
            <button className="btn-primary" onClick={saveProfile}>
              Enregistrer le profil
            </button>
          </div>
        </Section>
        <Section title="Sécurité" subtitle="Changer le mot de passe">
          <div className="space-y-3">
            <div>
              <label className="label">Mot de passe actuel</label>
              <input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
            </div>
            <div>
              <label className="label">Nouveau mot de passe</label>
              <input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" placeholder="6 caractères minimum" />
            </div>
            <button className="btn-ghost" onClick={changePw} disabled={!pw.currentPassword || pw.newPassword.length < 6}>
              Changer
            </button>
          </div>
        </Section>
      </div>
    </>
  );
}
