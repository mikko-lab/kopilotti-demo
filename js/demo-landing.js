import { DEMO_VEHICLE } from './demo-vehicle.js';

document.getElementById('demoVehicleName').textContent = DEMO_VEHICLE.makeModel;
document.getElementById('demoVehicleRegistration').textContent = DEMO_VEHICLE.registration;
document.getElementById('demoVehiclePrice').textContent = `${DEMO_VEHICLE.listPrice.toLocaleString('fi-FI')} €`;
