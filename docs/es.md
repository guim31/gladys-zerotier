# ZeroTier

Siga a los miembros de sus redes [ZeroTier](https://www.zerotier.com) en
Gladys: un dispositivo por miembro (en línea o no, autorizado o no, visto por
última vez, dirección IP gestionada, versión de ZeroTier), un dispositivo por
red, un widget del panel y disparadores de escena cuando un miembro se
conecta, se desconecta o pide unirse — por ejemplo, para saber que un móvil ha
vuelto a la red familiar, o que un dispositivo desconocido llama a la puerta de
una red privada.

Funciona con **ZeroTier Central** (my.zerotier.com, la nube) o con un
**controlador autoalojado** (su propio nodo ZeroTier que gestiona sus redes).
El modo autoalojado se ha probado con un controlador y un miembro ZeroTier
1.14.2 reales en Docker. El modo Central se ha desarrollado a partir de la
documentación oficial de la API, **sin una cuenta Central real: sus
comentarios son bienvenidos** en el
[foro de Gladys](https://community.gladysassistant.com) o en las
[issues](https://github.com/guim31/gladys-zerotier/issues).

## Qué necesita

- Gladys Assistant 5.1.0 o posterior.
- **ZeroTier Central**: un token de API de la cuenta propietaria de las redes
  (my.zerotier.com → Account → API Access Tokens), y acceso a Internet para
  Gladys.
- **Controlador autoalojado**: el nodo ZeroTier que ejecuta el controlador,
  accesible desde Gladys en su puerto 9993, el contenido de su archivo
  `authtoken.secret`, y la dirección de Gladys permitida en su `local.conf`
  (vea más abajo).

## Configuración

1. En Gladys, instale la integración y abra su pantalla de **Configuración**.
2. **Controlador**: _ZeroTier Central (nube)_ o _Controlador autoalojado
   (local)_.
3. **Token de API**: el token de Central, o el contenido de
   `authtoken.secret`.
4. **Redes a seguir**: los identificadores de red (16 caracteres, como los
   muestra Central o `zerotier-cli listnetworks`), separados por comas. Vacío:
   todas las redes que ve el token.
5. **Intervalo de actualización**: 1 minuto por defecto. Cada lectura cuesta
   una solicitud, más una por red.
6. **Permitir autorizar miembros**: desactivado por defecto (vea los
   dispositivos más abajo).
7. **Idioma de los nombres**: el idioma de los nombres de las funciones y de
   las fechas, francés por defecto.
8. Guarde y pulse **Probar la conexión**: cada red aparece con sus miembros.
   Los dispositivos aparecen después en la pestaña **Descubrimiento** de la
   integración: añada los que quiera.

### ZeroTier Central

Cree un token en my.zerotier.com → **Account** → **API Access Tokens**. Da
acceso a todas las redes de la cuenta: guárdelo para usted. Central limita el
número de solicitudes de API por cuenta: mantenga el intervalo por defecto si
otras herramientas usan el mismo token.

### Controlador autoalojado

Por defecto, la API local de ZeroTier solo responde al propio nodo. Permita la
dirección desde la que llama Gladys en el archivo `local.conf` de la carpeta
de ZeroTier del controlador (`/var/lib/zerotier-one` en Linux) y reinicie
ZeroTier:

```json
{ "settings": { "allowManagementFrom": ["192.168.1.0/24"] } }
```

Gladys llama desde su máquina (la integración se ejecuta en un contenedor
Docker en el puente por defecto): permita la dirección de la máquina de
Gladys o, si el controlador se ejecuta en la misma máquina, el rango de Docker
(`172.16.0.0/12`). Como **Dirección del controlador (autoalojado)**, indique la
dirección de la máquina del controlador en su red local, nunca `127.0.0.1`.

## Los dispositivos

**Cada red** (`ZeroTier` seguido de su nombre):

| Función                    | Qué muestra                                          |
| -------------------------- | ---------------------------------------------------- |
| Miembros en línea          | Los miembros en línea en este momento                |
| Miembros                   | Los miembros de la red                               |
| Pendientes de autorización | Los miembros que han pedido unirse y todavía esperan |

**Cada miembro** (su nombre, o su ID de nodo si no tiene, seguido de
`(ZeroTier)`):

| Función                 | Qué muestra                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------- |
| En línea                | Sí cuando el miembro se ha visto hace unos minutos como mucho                         |
| Autorizado              | Si el miembro está autorizado en la red (un interruptor, de solo lectura por defecto) |
| Visto por última vez    | La fecha y la hora en que el miembro se vio por última vez                            |
| Dirección IP gestionada | Las direcciones que le da la red (`Ninguna` si no tiene)                              |
| Versión de ZeroTier     | La versión de ZeroTier del miembro                                                    |

La misma máquina en dos redes son dos dispositivos: su autorización es propia
de cada red.

**En línea** se lee de forma distinta según el modo. Con Central, un miembro
está en línea cuando se ha comunicado con Central hace menos de 5 minutos (los
miembros se comunican más o menos cada minuto). Con un controlador
autoalojado, el controlador no guarda esa fecha: la integración lee los pares
del nodo, y un miembro está en línea cuando el controlador lo ha oído hace
menos de 3 minutos. Un miembro alcanzado a través de un relé (sin ruta
directa) cuenta como en línea mientras el nodo lo liste.

**Autorizado** solo se convierte en un comando cuando **Permitir autorizar
miembros** está activado: entonces Gladys, sus escenas y los asistentes de voz
pueden admitir o cortar a un miembro. Activar o desactivar la opción cambia el
dispositivo: pulse **Actualizar** en la pestaña Descubrimiento.

## Panel

El widget **Miembros ZeroTier** muestra los miembros en línea y los miembros
de las redes, y luego una fila por miembro: primero los que esperan
autorización, luego los que están en línea y después los demás con el momento
en que se vieron. Su ajuste **Red (vacío: todas)** muestra una sola red.

## Escenas

### Disparadores

- **Miembro ZeroTier en línea**: un miembro se ha conectado.
- **Miembro ZeroTier fuera de línea**: un miembro lleva unos minutos sin verse.
- **Nuevo miembro pendiente de autorización**: un nuevo dispositivo ha pedido
  unirse a una red privada.

Cada disparador puede limitarse a un miembro (**Miembro (vacío: cualquiera)**)
o a una red (**Red (vacío: cualquiera)**), y da las variables **Nombre del
miembro**, **ID del nodo** y **Nombre de la red** a los mensajes de la escena.
No se envía ningún evento en la primera lectura tras un arranque o un cambio de
configuración: el estado anterior es desconocido.

### Ideas de escenas

- Cuando un nuevo miembro espera autorización, envíese un mensaje con su **ID
  del nodo** y el **Nombre de la red**, y autorícelo en Central o desde su
  dispositivo en Gladys.
- Cuando el portátil de un adolescente se conecta después de las 23 h, envíe
  una notificación.
- Cuando el NAS remoto que guarda sus copias de seguridad se desconecta, envíe
  un mensaje.

## Solución de problemas

- **«token de API rechazado»**: compruebe el token. Para un controlador
  autoalojado, es todo el contenido de `authtoken.secret`, sin salto de línea.
- **«ZeroTier no responde»**: con Central, compruebe el acceso a Internet de
  Gladys. Con un controlador autoalojado, compruebe la dirección y el puerto
  (9993), y que `allowManagementFrom` permita a Gladys (vea más arriba).
- **«red no encontrada»**: el identificador de red es incorrecto, o el token no
  ve esa red.
- **«este nodo ZeroTier no es un controlador de red»**: la dirección es la de
  un nodo ZeroTier corriente, no la del controlador de sus redes.
- **«demasiadas solicitudes a ZeroTier Central»**: la integración ya espera más
  entre dos lecturas; elija un intervalo más largo.
- **Un miembro sigue en línea después de apagarlo**: tarda hasta 5 minutos,
  más una lectura, y hasta unos 9 minutos para un miembro relayado de un
  controlador autoalojado.

## Límites

- Un controlador (o una cuenta Central) por instalación de la integración.
- La integración no crea redes, ni renombra ni borra miembros: eso se queda en
  Central o en su controlador.
- La fecha «visto por última vez» de un controlador autoalojado se guarda en
  memoria: vuelve a ser desconocida tras un reinicio de la integración, hasta
  que el miembro se vuelva a ver.
- Los miembros borrados en Central (ocultos por Central) no se muestran.
- Sin relación con ZeroTier, Inc. ZeroTier es una marca de ZeroTier, Inc.
