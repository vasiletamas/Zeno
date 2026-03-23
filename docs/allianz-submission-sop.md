# Procedura Operationala Standard — Transmitere Cereri catre Allianz-Tiriac

**Aplicatie:** Zeno — Agent Vanzari Asigurari de Viata cu AI
**Versiune:** 1.0
**Data:** 2026-03-23

---

## 1. Autentificare

1. Navigati la `https://use-zeno.com/admin`
2. Introduceti adresa de email si parola de operator
3. Apasati **Conectare**

---

## 2. Verificare Aplicatii Noi

1. Pe Dashboard, verificati sectiunea **"Aplicatii noi"** — numarul indica cereri noi neprocessate
2. Apasati pe numar sau pe butonul **"Vezi aplicatii"** pentru lista completa
3. Aplicatiile noi au statusul **PENDING_SUBMISSION** (in asteptare)

**SLA:** Aplicatiile noi trebuie procesate in maximum **2 ore** (in timpul programului de lucru, L-V 09:00-18:00).

---

## 3. Revizuire Aplicatie

1. Apasati pe o aplicatie din lista pentru a vedea detaliile complete
2. Verificati:
   - **Datele clientului**: nume, varsta, CNP, email, telefon
   - **Raspunsurile la intrebari**: DNT complet, chestionar medical
   - **Pachetul ales**: tier (Standard/Optim), nivel premium
   - **Cotatie**: prima anuala, acoperiri incluse
   - **Plata**: status confirmat
   - **Semnale de alerta** (flags): daca exista, verificati manual inainte de trimitere

---

## 4. Generare Email Allianz

1. In pagina aplicatiei, apasati butonul **"Generare Email Allianz"**
2. Sistemul genereaza automat un email pre-completat cu toate datele necesare
3. Verificati continutul emailului generat
4. Apasati **"Copiaza"** pentru a copia textul in clipboard

---

## 5. Trimitere catre Allianz

1. Deschideti clientul de email (Outlook / Gmail)
2. Creati un email nou catre contactul Allianz-Tiriac desemnat
3. Lipiti continutul copiat (Ctrl+V)
4. Atasati documentele necesare (daca este cazul):
   - Raportul DNT (generat automat, disponibil in sectiunea Documente)
   - Declaratii suplimentare
5. Trimiteti emailul

---

## 6. Marcare ca Transmis

1. Reveniti in panoul de administrare Zeno
2. Pe aplicatia trimisa, apasati **"Marcare Transmis"**
3. Statusul se schimba in **SUBMITTED**

---

## 7. Activare Polita

Cand primiti confirmarea de la Allianz-Tiriac:

1. Navigati la aplicatia confirmata in panoul de administrare
2. Apasati butonul **"Activare Polita"**
3. Introduceti **numarul politei Allianz** primit in confirmarea de la Allianz-Tiriac
4. Apasati **Confirma Activare**
5. Statusul se schimba in **ACTIVE**
6. Sistemul trimite automat un email clientului cu confirmarea activarii

**SLA:** De la confirmarea Allianz la activarea politei in sistem — maximum **24 ore**.

---

## 8. Notificarea Clientului

Dupa activarea politei:

- Sistemul trimite **automat** un email clientului cu:
  - Confirmarea activarii politei
  - Numarul politei Allianz-Tiriac
  - Link catre dashboard-ul clientului (magic link, valabil 7 zile)
  - Sumar acoperiri si prima

**Nota:** Nu este necesara nicio actiune manuala pentru notificarea clientului.

---

## 9. Termene SLA

| Actiune | Termen maxim |
|---------|-------------|
| Aplicatie noua → Email catre Allianz | 2 ore (program lucru) |
| Confirmare Allianz → Activare polita | 24 ore |
| Activare polita → Email client | Imediat (automat) |

---

## 10. Situatii Exceptionale

### Aplicatie cu semnale de alerta (flags)
- Verificati motivul semnalului in sectiunea **"Semnale de Alerta"**
- Daca semnalul necesita verificare suplimentara, contactati clientul direct
- Documentati decizia in campul de note inainte de trimitere

### Cerere respinsa de Allianz
- Marcati polita ca **CANCELLED** in panoul de administrare
- Contactati clientul telefonic sau prin email cu explicatia
- Oferiti alternative daca este posibil

### Probleme tehnice
- Verificati statusul sistemului la `https://use-zeno.com/api/health`
- Contactati echipa tehnica daca statusul nu este "ok"
