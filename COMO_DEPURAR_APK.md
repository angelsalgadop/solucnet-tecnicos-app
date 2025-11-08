# 🔍 CÓMO DEPURAR LA APP ANDROID SIN COMPILAR

## Método 1: Chrome Remote Debugging (RECOMENDADO)

Este método te permite ver **exactamente** qué está pasando dentro del APK instalado en tu teléfono.

### Pasos:

1. **Habilitar debugging en tu teléfono:**
   - Ve a `Configuración` → `Acerca del teléfono`
   - Toca 7 veces sobre `Número de compilación`
   - Vuelve atrás
   - Entra a `Opciones de desarrollador`
   - Activa `Depuración USB`

2. **Conectar teléfono a tu computadora:**
   - Conecta con cable USB
   - Acepta "Permitir depuración USB" en el teléfono

3. **Abrir Chrome en tu computadora:**
   - Abre Google Chrome
   - Ve a: `chrome://inspect/#devices`

4. **Abrir la app en tu teléfono:**
   - Abre SolucNet Técnicos
   - Haz login

5. **En Chrome verás tu dispositivo:**
   - Aparecerá "com.solucnet.tecnicos"
   - Click en `inspect`

6. **Verás la consola del navegador:**
   - Pestaña "Console" muestra TODOS los logs
   - Pestaña "Network" muestra TODAS las peticiones
   - Pestaña "Application" muestra localStorage

### Qué buscar:

```
❌ Errores en rojo
⚠️ Advertencias en amarillo
🔍 Los console.log() que agregamos
🌐 Peticiones fetch que fallan
```

---

## Método 2: Ver logs desde código

He agregado logging detallado. Después de intentar login, ejecuta esto en la consola de Chrome Remote Debugging:

```javascript
// Ver todos los logs guardados
console.log('=== LOGS GUARDADOS ===');
console.log('Token:', localStorage.getItem('token_tecnico'));
console.log('Usuario:', localStorage.getItem('user_tecnico'));
console.log('Último error:', localStorage.getItem('ultimo_error'));
```

---

## Método 3: Probar localmente ANTES de compilar

```bash
# En tu servidor donde está el código
cd /tmp/solucnet-tecnicos-clean
npx cap run android --livereload --external
```

Esto:
- Abre la app en tu teléfono
- RECARGA automáticamente al hacer cambios
- NO necesitas compilar cada vez

---

## 🎯 Una vez que sepas el error REAL

Cuando veas el error exacto en Chrome Remote Debugging, mándame:

1. **Screenshot de la consola** (pestaña Console)
2. **Screenshot de Network** (pestaña Network)
3. **El error exacto** que sale en rojo

Con eso puedo solucionar el problema DEFINITIVAMENTE.
